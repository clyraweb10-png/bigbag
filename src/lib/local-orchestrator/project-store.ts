import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { VcaasProject, VcaasProjectSummary } from "@/lib/vcaas-types";
import type { LocalProjectRecord } from "./types";
import { durableProjectStore, durablePersistenceConfigured } from "./durable-project-store";

const DATA_DIR = path.join(process.cwd(), "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const PROJECTS_LOCK = path.join(DATA_DIR, "projects.json.lock");
const PROJECTS_RECOVERY_LOCK = path.join(DATA_DIR, "projects.json.recovery.lock");
const activeLockTokens = new Set<string>();
const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(WORKSPACES_DIR)) {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}

function readProjects(): Record<string, LocalProjectRecord> {
  if (!fs.existsSync(PROJECTS_FILE)) return {};
  const parsed: unknown = JSON.parse(fs.readFileSync(PROJECTS_FILE, "utf-8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The local project index is invalid");
  }
  return parsed as Record<string, LocalProjectRecord>;
}

function saveProjects(projects: Record<string, LocalProjectRecord>): void {
  const temporary = `${PROJECTS_FILE}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(projects, null, 2), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(temporary, PROJECTS_FILE);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}

function lockOwner(directory: string): { token: string; pid: number } | null {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(directory, "owner.json"), "utf8"));
    return typeof owner.token === "string" && Number.isInteger(owner.pid) ? owner : null;
  } catch {
    return null;
  }
}

function reclaimStaleDirectory(directory: string): boolean {
  let observed: fs.Stats;
  try { observed = fs.statSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const owner = lockOwner(directory);
  // An active writer may be paused beyond the stale-age threshold. Age alone
  // cannot justify stealing its lock and allowing concurrent index writes.
  const ownerIsActive = owner && (owner.pid === process.pid
    ? activeLockTokens.has(owner.token)
    : processIsAlive(owner.pid));
  if (ownerIsActive || (!owner && Date.now() - observed.mtimeMs <= 10_000)) return false;

  // Recheck immediately before the atomic claim. A waiter that observed an
  // older lock must never use that observation to remove a new holder's lock.
  let current: fs.Stats;
  try { current = fs.statSync(directory); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const currentOwner = lockOwner(directory);
  const currentOwnerIsActive = currentOwner && (currentOwner.pid === process.pid
    ? activeLockTokens.has(currentOwner.token)
    : processIsAlive(currentOwner.pid));
  if (current.ino !== observed.ino || current.dev !== observed.dev ||
      currentOwner?.token !== owner?.token || currentOwner?.pid !== owner?.pid ||
      currentOwnerIsActive || (!currentOwner && Date.now() - current.mtimeMs <= 10_000)) return false;

  const abandoned = `${directory}.abandoned-${randomUUID()}`;
  try { fs.renameSync(directory, abandoned); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  const moved = fs.statSync(abandoned);
  if (moved.ino !== observed.ino || moved.dev !== observed.dev || lockOwner(abandoned)?.token !== owner?.token) {
    if (!fs.existsSync(directory)) fs.renameSync(abandoned, directory);
    throw new Error("A lock changed during stale-lock recovery");
  }
  fs.rmSync(abandoned, { recursive: true, force: true });
  return true;
}

function recoverProjectsLock(): void {
  const recoveryToken = randomUUID();
  let created = false;
  try {
    fs.mkdirSync(PROJECTS_RECOVERY_LOCK);
    created = true;
    fs.writeFileSync(path.join(PROJECTS_RECOVERY_LOCK, "owner.json"),
      JSON.stringify({ token: recoveryToken, pid: process.pid }), { flag: "wx", mode: 0o600 });
    activeLockTokens.add(recoveryToken);
  } catch (error) {
    if (created) {
      try { fs.rmSync(PROJECTS_RECOVERY_LOCK, { recursive: true, force: true }); } catch {}
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    reclaimStaleDirectory(PROJECTS_RECOVERY_LOCK);
    return;
  }
  try {
    // Recovery is serialized. Every waiter observes the main lock again only
    // after claiming this guard, so a new live owner is left untouched.
    reclaimStaleDirectory(PROJECTS_LOCK);
  } finally {
    if (lockOwner(PROJECTS_RECOVERY_LOCK)?.token === recoveryToken) {
      fs.rmSync(PROJECTS_RECOVERY_LOCK, { recursive: true, force: true });
    }
    activeLockTokens.delete(recoveryToken);
  }
}

function processIsAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function mutateProjects<T>(change: (projects: Record<string, LocalProjectRecord>) => { result: T; changed: boolean }): T {
  const started = Date.now();
  const pause = new Int32Array(new SharedArrayBuffer(4));
  const ownerToken = randomUUID();
  for (;;) {
    let created = false;
    try {
      fs.mkdirSync(PROJECTS_LOCK);
      created = true;
      fs.writeFileSync(path.join(PROJECTS_LOCK, "owner.json"), JSON.stringify({ token: ownerToken, pid: process.pid }), { flag: "wx", mode: 0o600 });
      activeLockTokens.add(ownerToken);
      break;
    } catch (error) {
      if (created) {
        try { fs.rmSync(PROJECTS_LOCK, { recursive: true, force: true }); } catch {}
        throw error;
      }
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      recoverProjectsLock();
      if (Date.now() - started > 15_000) throw new Error("The local project index is busy");
      Atomics.wait(pause, 0, 0, 20);
    }
  }
  try {
    const projects = readProjects();
    const { result, changed } = change(projects);
    if (changed) saveProjects(projects);
    return result;
  } finally {
    if (lockOwner(PROJECTS_LOCK)?.token === ownerToken) {
      fs.rmSync(PROJECTS_LOCK, { recursive: true, force: true });
    }
    activeLockTokens.delete(ownerToken);
  }
}

function allocatePort(existing: Record<string, LocalProjectRecord>): number {
  const usedPorts = new Set(Object.values(existing).map((p) => p.port));
  let port = 3001;
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}

export function persistentPreviewPath(projectId: string): string {
  return `/api/preview/${encodeURIComponent(projectId)}/`;
}

export function persistentPublishedPath(projectId: string): string {
  return `/api/preview/${encodeURIComponent(projectId)}/__published/`;
}

export function persistentPreviewUrl(projectId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return base ? `${base}${persistentPreviewPath(projectId)}` : persistentPreviewPath(projectId);
}

export function persistentPublishedUrl(projectId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return base ? `${base}${persistentPublishedPath(projectId)}` : persistentPublishedPath(projectId);
}

import { STARTER_TEMPLATES } from "@/lib/starter-templates";

export function resolveStarterPreviewImage(label?: string, description?: string, projectId?: string): string | null {
  const normLabel = (label || "").trim().toLowerCase();
  const normDesc = (description || "").trim().toLowerCase();
  const normId = (projectId || "").trim().toLowerCase();
  if (!normLabel && !normDesc && !normId) return null;

  const found = STARTER_TEMPLATES.find((t) => {
    const tId = t.id.toLowerCase();
    const tTitle = t.title.toLowerCase();
    return (
      (tId && (normId === tId || normId.startsWith(`${tId}-`))) ||
      (tTitle && (normLabel === tTitle || normDesc.includes(tTitle)))
    );
  });
  return found?.previewImage ?? null;
}

export function toVcaasProject(record: LocalProjectRecord): VcaasProject {
  const previewUrl = persistentPreviewPath(record.projectId);
  
  // Map local server status to VCaaS expected status
  let serverStatus: "Active" | "Starting" | "Creating" | "Archived" | "Unarchiving" | "Archiving";
  if (record.importInProgress) {
    serverStatus = "Starting";
  } else if (record.serverStatus === "Active") {
    serverStatus = "Active";
  } else if (record.serverStatus === "Error") {
    serverStatus = "Starting"; // Treat errors as needing to start
  } else {
    serverStatus = "Starting";
  }
  
  return {
    projectId: record.projectId,
    conversationId: record.conversationId,
    activeGenerationId: record.activeGenerationId,
    projectContext: record.projectContext,
    label: record.label || record.projectId,
    description: record.description,
    plan: "Local Developer",
    agentProcessStatus: record.status,
    agentServerStatus: serverStatus,
    createdAt: record.createdAt,
    importInProgress: record.importInProgress
      ? {
          startedAt: record.importInProgress.startedAt,
          errorMessage: record.importInProgress.errorMessage,
        }
      : null,
    deployment: record.deployment
      ? {
          status: record.deployment.status,
          createdAt: record.deployment.createdAt,
          versionId: record.deployment.versionId,
        }
      : null,
    secrets: [],
    temporalDevelopmentProjectUrl: previewUrl,
    cachedDevelopmentUrl: previewUrl,
    developmentUrlFieldToUse: "temporalDevelopmentProjectUrl",
    productionProjectUrl: record.deployment?.status === "success"
      ? persistentPublishedUrl(record.projectId)
      : record.productionProjectUrl,
    previewImageUrl: record.screenshotUrl || resolveStarterPreviewImage(record.label, record.description, record.projectId) || null,
    totalCreditsSpent: 0,
  };
}

type SharedPersistenceState = {
  hydratedProjects: Set<string>;
  recordWrites: Map<string, Promise<void>>;
};

const persistenceStateKey = Symbol.for("bigbag.local-orchestrator.persistence-state");
const persistenceGlobal = globalThis as typeof globalThis & {
  [persistenceStateKey]?: SharedPersistenceState;
};
const persistenceState = persistenceGlobal[persistenceStateKey] || {
  hydratedProjects: new Set<string>(),
  recordWrites: new Map<string, Promise<void>>(),
};
persistenceGlobal[persistenceStateKey] = persistenceState;

function queueRecordWrite(record: LocalProjectRecord): Promise<void> {
  if (!durablePersistenceConfigured()) return Promise.resolve();
  const snapshot = structuredClone(record);
  const previous = persistenceState.recordWrites.get(record.projectId) || Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => durableProjectStore.saveRecord(snapshot));
  persistenceState.recordWrites.set(record.projectId, next);
  void next.finally(() => {
    if (persistenceState.recordWrites.get(record.projectId) === next) {
      persistenceState.recordWrites.delete(record.projectId);
    }
  }).catch(() => undefined);
  return next;
}

function replaceCachedRecord(record: LocalProjectRecord): void {
  mutateProjects((projects) => {
    const cached = projects[record.projectId];
    if (cached && modifiedTime(cached) > modifiedTime(record)) return { result: undefined, changed: false };
    projects[record.projectId] = record;
    return { result: undefined, changed: true };
  });
}

function modifiedTime(record: LocalProjectRecord): number {
  const parsed = Date.parse(record.lastModifiedAt || record.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextModifiedAt(record: LocalProjectRecord): string {
  return new Date(Math.max(Date.now(), modifiedTime(record) + 1)).toISOString();
}

function identifyGenerationEvents(conversation: LocalProjectRecord["conversation"]): void {
  let generationId: string | undefined;
  for (const message of conversation || []) {
    const event = message.generationEvent;
    if (!event) continue;
    if (event.type === "generation_started") {
      generationId = event.generationId || randomUUID();
    }
    event.eventId ||= randomUUID();
    event.generationId ||= generationId;
    event.occurredAt ||= message.createdAt;
  }
}

export const localProjectStore = {
  getWorkspaceDir(projectId: string): string {
    if (!/^[a-z0-9][a-z0-9_-]{0,127}$/i.test(projectId)) {
      throw new Error("Invalid project id");
    }
    const dir = path.join(WORKSPACES_DIR, projectId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  },

  list(tenantId: string): VcaasProjectSummary[] {
    const projects = readProjects();
    return Object.values(projects).filter((p) => p.tenantId === tenantId).map((p) => ({
      projectId: p.projectId,
      label: p.label || p.projectId,
      description: p.description,
      plan: "Local",
      createdAt: p.createdAt,
      lastModifiedAt: p.lastModifiedAt,
      previewImageUrl: p.screenshotUrl || resolveStarterPreviewImage(p.label, p.description, p.projectId) || null,
    }));
  },

  get(projectId: string): VcaasProject | null {
    const projects = readProjects();
    const record = projects[projectId];
    if (!record) return null;
    return toVcaasProject(record);
  },

  getRecord(projectId: string): LocalProjectRecord | null {
    const projects = readProjects();
    return projects[projectId] || null;
  },

  /** Persist a Firecrawl screenshot URL so the dashboard thumbnail survives page reloads. */
  saveScreenshotUrl(projectId: string, screenshotUrl: string): void {
    const record = mutateProjects((projects) => {
      const record = projects[projectId];
      if (!record) return { result: null, changed: false };
      record.screenshotUrl = screenshotUrl;
      record.lastModifiedAt = nextModifiedAt(record);
      return { result: record, changed: true };
    });
    if (!record) return;
    void queueRecordWrite(record);
  },

  findRecordsByProjectIdPrefix(projectIdPrefix: string): LocalProjectRecord[] {
    return Object.values(readProjects())
      .filter((record) => record.projectId === projectIdPrefix || record.projectId.startsWith(`${projectIdPrefix}-`))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  },

  create(body: { projectId: string; description: string; label?: string; tenantId: string; qualificationRunId?: string; screenshotUrl?: string }): VcaasProject {
    const record = mutateProjects((projects) => {
    let id = body.projectId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!id || id === "-") id = `app-${Date.now()}`;
    // Qualification IDs are reserved durably before local creation. A local
    // collision must fail this attempt instead of silently creating a second
    // project whose durable record cannot be safely rolled back.
    if (body.qualificationRunId && projects[id]) {
      throw new Error("Qualification project id is already in use");
    }
    
    // Ensure uniqueness
    let counter = 1;
    let uniqueId = id;
    while (projects[uniqueId]) {
      uniqueId = `${id}-${counter++}`;
    }

    const port = allocatePort(projects);
    const now = new Date().toISOString();
    const record: LocalProjectRecord = {
      projectId: uniqueId,
      tenantId: body.tenantId,
      label: body.label || body.description.slice(0, 30) || uniqueId,
      description: body.description,
      ...(body.qualificationRunId ? { qualificationRunId: body.qualificationRunId } : {}),
      ...(body.screenshotUrl ? { screenshotUrl: body.screenshotUrl } : {}),
      createdAt: now,
      lastModifiedAt: now,
      port,
      status: "idle",
      conversationId: randomUUID(),
      serverStatus: "Starting",
      rebuildStatus: "idle",
      conversation: [],
    };

    projects[uniqueId] = record;
    return { result: record, changed: true };
    });
    void queueRecordWrite(record).catch((error) => {
      console.error(`[project-store] Could not persist ${record.projectId}:`, error);
    });

    // Prepare workspace directory
    this.getWorkspaceDir(record.projectId);

    return toVcaasProject(record);
  },

  update(projectId: string, patch: Partial<LocalProjectRecord>): LocalProjectRecord | null {
    let changed = false;
    const result = mutateProjects((projects) => {
    const record = projects[projectId];
    if (!record) return { result: null, changed: false };

    if (record.cancellationRequestedAt && patch.status !== "init") {
      const cancelling = patch.conversation?.at(-1)?.generationEvent?.type === "generation_cancelled";
      // A terminal job must reject its own late stage/file/preview events, but
      // the same project conversation must remain usable for ordinary chat.
      const appendOnlyChat = Boolean(patch.conversation &&
        patch.conversation.length > record.conversation.length &&
        record.conversation.every((message, index) => {
          const candidate = patch.conversation?.[index];
          return candidate?.author === message.author && candidate?.message === message.message &&
            candidate?.createdAt === message.createdAt && candidate?.generationEvent?.eventId === message.generationEvent?.eventId;
        }) && patch.conversation.slice(record.conversation.length).every((message) =>
          message.messageType === "regular" && !message.generationEvent
        ));
      if ((patch.conversation && !cancelling && !appendOnlyChat) || (!cancelling && (patch.previewUrl || patch.deployment || patch.serverStatus || patch.status))) {
        return { result: record, changed: false };
      }
    }

    if (patch.conversation) identifyGenerationEvents(patch.conversation);
    Object.assign(record, patch, { lastModifiedAt: nextModifiedAt(record) });
    projects[projectId] = record;
    changed = true;
    return { result: record, changed: true };
    });
    if (changed && result) void queueRecordWrite(result).catch((error) => {
      console.error(`[project-store] Could not persist ${projectId}:`, error);
    });
    return result;
  },

  remove(projectId: string): boolean {
    const removed = mutateProjects((projects) => {
      if (!projects[projectId]) return { result: false, changed: false };
      delete projects[projectId];
      return { result: true, changed: true };
    });
    if (!removed) return false;

    // Optionally cleanup workspace
    const dir = path.join(WORKSPACES_DIR, projectId);
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn("Could not delete directory:", dir, e);
    }
    return true;
  },

  async waitForRecordPersistence(projectId: string): Promise<void> {
    await persistenceState.recordWrites.get(projectId);
  },

  owns(projectId: string, tenantId: string): boolean {
    return readProjects()[projectId]?.tenantId === tenantId;
  },

  async hydrateTenant(tenantId: string): Promise<void> {
    if (!durablePersistenceConfigured()) return;
    const records = await durableProjectStore.listRecords(tenantId);
    mutateProjects((projects) => {
    let changed = false;
    for (const record of records) {
      if (persistenceState.recordWrites.has(record.projectId)) continue;
      const cached = projects[record.projectId];
      if (cached && modifiedTime(cached) > modifiedTime(record)) continue;
      projects[record.projectId] = record;
      changed = true;
    }
    return { result: undefined, changed };
    });
  },

  async hydrateProject(projectId: string, tenantId: string): Promise<boolean> {
    const hydrationKey = `${tenantId}:${projectId}`;
    if (persistenceState.hydratedProjects.has(hydrationKey)) {
      const owned = this.owns(projectId, tenantId);
      if (!owned) return false;
      const workspaceDir = this.getWorkspaceDir(projectId);
      if (!fs.existsSync(path.join(workspaceDir, "package.json")) && durablePersistenceConfigured()) {
        await durableProjectStore.restoreSource(projectId, tenantId, workspaceDir);
      }
      return true;
    }

    if (!durablePersistenceConfigured()) {
      const owned = this.owns(projectId, tenantId);
      if (owned) persistenceState.hydratedProjects.add(hydrationKey);
      return owned;
    }

    const cached = this.getRecord(projectId);
    if (cached?.tenantId === tenantId && persistenceState.recordWrites.has(projectId)) {
      persistenceState.hydratedProjects.add(hydrationKey);
      return true;
    }

    const record = await durableProjectStore.loadRecord(projectId, tenantId);
    if (!record) return false;
    const workspaceDir = this.getWorkspaceDir(projectId);
    const useRemoteRecord = !cached || modifiedTime(record) >= modifiedTime(cached);
    if (useRemoteRecord) {
      replaceCachedRecord(record);
      await durableProjectStore.restoreSource(projectId, tenantId, workspaceDir);
    } else if (!fs.existsSync(path.join(workspaceDir, "package.json"))) {
      // Metadata can be newer than the last source snapshot when the process died
      // mid-flush. Restoring that snapshot is still preferable to an empty sandbox.
      await durableProjectStore.restoreSource(projectId, tenantId, workspaceDir);
    }
    persistenceState.hydratedProjects.add(hydrationKey);
    return true;
  },

  async persistSource(projectId: string): Promise<void> {
    // Each accepted source snapshot needs a newer logical record version.
    // Build retries may persist identical source again, while stale workers
    // must still be rejected by the durable compare-and-swap guard.
    const record = this.update(projectId, {});
    if (!record) throw new Error(`Project ${projectId} not found`);
    await this.flush(projectId);
    await durableProjectStore.saveSource(record, this.getWorkspaceDir(projectId));
  },

  async flush(projectId: string): Promise<void> {
    await persistenceState.recordWrites.get(projectId);
  },
};
