import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { VcaasProject, VcaasProjectSummary } from "@/lib/vcaas-types";
import type { LocalProjectRecord } from "./types";
import { durableProjectStore, durablePersistenceConfigured } from "./durable-project-store";

const DATA_DIR = path.join(process.cwd(), "data");
const PROJECTS_FILE = path.join(DATA_DIR, "projects.json");
const WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(WORKSPACES_DIR)) {
  fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
}

function readProjects(): Record<string, LocalProjectRecord> {
  try {
    if (!fs.existsSync(PROJECTS_FILE)) {
      return {};
    }
    const raw = fs.readFileSync(PROJECTS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error("Failed to read projects.json:", err);
    return {};
  }
}

function saveProjects(projects: Record<string, LocalProjectRecord>): void {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2), "utf-8");
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

export function persistentPreviewUrl(projectId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  return base ? `${base}${persistentPreviewPath(projectId)}` : persistentPreviewPath(projectId);
}

export function toVcaasProject(record: LocalProjectRecord): VcaasProject {
  const previewUrl = persistentPreviewPath(record.projectId);
  
  // Map local server status to VCaaS expected status.
  // "Error" and "Stopped" map to "Archived" so the workspace's server-wake flow
  // activates and the user is prompted to restart instead of seeing a misleading
  // "Starting" spinner that never resolves. "Starting" stays as-is for projects
  // genuinely mid-start (e.g. build in progress).
  let serverStatus: "Active" | "Starting" | "Creating" | "Archived" | "Unarchiving" | "Archiving";
  if (record.serverStatus === "Active") {
    serverStatus = "Active";
  } else if (record.serverStatus === "Error" || record.serverStatus === "Stopped") {
    serverStatus = "Archived";
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
    productionProjectUrl: record.productionProjectUrl,
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
  const projects = readProjects();
  projects[record.projectId] = record;
  saveProjects(projects);
}

function modifiedTime(record: LocalProjectRecord): number {
  const parsed = Date.parse(record.lastModifiedAt || record.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
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

  create(body: { projectId: string; description: string; label?: string; tenantId: string }): VcaasProject {
    const projects = readProjects();
    let id = body.projectId.toLowerCase().replace(/[^a-z0-9-]/g, "-");
    if (!id || id === "-") id = `app-${Date.now()}`;
    
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
    saveProjects(projects);
    void queueRecordWrite(record).catch((error) => {
      console.error(`[project-store] Could not persist ${uniqueId}:`, error);
    });

    // Prepare workspace directory
    this.getWorkspaceDir(uniqueId);

    return toVcaasProject(record);
  },

  update(projectId: string, patch: Partial<LocalProjectRecord>): LocalProjectRecord | null {
    const projects = readProjects();
    const record = projects[projectId];
    if (!record) return null;

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
        return record;
      }
    }

    if (patch.conversation) identifyGenerationEvents(patch.conversation);
    Object.assign(record, patch, { lastModifiedAt: new Date().toISOString() });
    projects[projectId] = record;
    saveProjects(projects);
    void queueRecordWrite(record).catch((error) => {
      console.error(`[project-store] Could not persist ${projectId}:`, error);
    });
    return record;
  },

  remove(projectId: string): boolean {
    const projects = readProjects();
    if (!projects[projectId]) return false;
    delete projects[projectId];
    saveProjects(projects);

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

  owns(projectId: string, tenantId: string): boolean {
    return readProjects()[projectId]?.tenantId === tenantId;
  },

  async hydrateTenant(tenantId: string): Promise<void> {
    if (!durablePersistenceConfigured()) return;
    const records = await durableProjectStore.listRecords(tenantId);
    const projects = readProjects();
    for (const record of records) {
      if (persistenceState.recordWrites.has(record.projectId)) continue;
      const cached = projects[record.projectId];
      if (cached && modifiedTime(cached) > modifiedTime(record)) continue;
      projects[record.projectId] = record;
    }
    saveProjects(projects);
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
    const record = this.getRecord(projectId);
    if (!record) throw new Error(`Project ${projectId} not found`);
    await this.flush(projectId);
    await durableProjectStore.saveSource(record, this.getWorkspaceDir(projectId));
  },

  async flush(projectId: string): Promise<void> {
    await persistenceState.recordWrites.get(projectId);
  },
};
