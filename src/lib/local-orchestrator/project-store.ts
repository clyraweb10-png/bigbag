import fs from "fs";
import path from "path";
import type { VcaasProject, VcaasProjectSummary } from "@/lib/vcaas-types";
import type { LocalProjectRecord } from "./types";
import { BIGBAG_DATA_DIR, BIGBAG_WORKSPACES_DIR } from "./storage-paths";

const PROJECTS_FILE = path.join(BIGBAG_DATA_DIR, "projects.json");

// Ensure data directory exists
if (!fs.existsSync(BIGBAG_DATA_DIR)) {
  fs.mkdirSync(BIGBAG_DATA_DIR, { recursive: true });
}
if (!fs.existsSync(BIGBAG_WORKSPACES_DIR)) {
  fs.mkdirSync(BIGBAG_WORKSPACES_DIR, { recursive: true });
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

let nextPort = 3001;

function allocatePort(existing: Record<string, LocalProjectRecord>): number {
  const usedPorts = new Set(Object.values(existing).map((p) => p.port));
  let port = 3001;
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}

export function toVcaasProject(record: LocalProjectRecord): VcaasProject {
  // Compiled Next.js apps always go through the same-origin preview proxy.
  const previewUrl = `/api/preview/${record.projectId}`;
  
  // Map local server status to VCaaS expected status
  let serverStatus: "Active" | "Starting" | "Creating" | "Archived" | "Unarchiving" | "Archiving";
  if (record.serverStatus === "Active") {
    serverStatus = "Active";
  } else if (record.serverStatus === "Error") {
    serverStatus = "Starting"; // Treat errors as needing to start
  } else {
    serverStatus = "Starting";
  }
  
  return {
    projectId: record.projectId,
    label: record.label || record.projectId,
    description: record.description,
    plan: "Local Developer",
    agentProcessStatus: record.status,
    agentServerStatus: serverStatus,
    createdAt: record.createdAt,
    secrets: [],
    temporalDevelopmentProjectUrl: previewUrl,
    cachedDevelopmentUrl: previewUrl,
    developmentUrlFieldToUse: "temporalDevelopmentProjectUrl",
    totalCreditsSpent: 0,
  };
}

export const localProjectStore = {
  getWorkspaceDir(projectId: string): string {
    const dir = path.join(BIGBAG_WORKSPACES_DIR, projectId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  },

  list(): VcaasProjectSummary[] {
    const projects = readProjects();
    return Object.values(projects).map((p) => ({
      projectId: p.projectId,
      label: p.label || p.projectId,
      description: p.description,
      plan: "Local",
      createdAt: p.createdAt,
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

  create(body: { projectId: string; description: string; label?: string }): VcaasProject {
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
      label: body.label || body.description.slice(0, 30) || uniqueId,
      description: body.description,
      createdAt: now,
      lastModifiedAt: now,
      port,
      status: "idle",
      serverStatus: "Starting",
      conversation: [],
    };

    projects[uniqueId] = record;
    saveProjects(projects);

    // Prepare workspace directory
    this.getWorkspaceDir(uniqueId);

    return toVcaasProject(record);
  },

  update(projectId: string, patch: Partial<LocalProjectRecord>): LocalProjectRecord | null {
    const projects = readProjects();
    const record = projects[projectId];
    if (!record) return null;

    Object.assign(record, patch, { lastModifiedAt: new Date().toISOString() });
    projects[projectId] = record;
    saveProjects(projects);
    return record;
  },

  remove(projectId: string): boolean {
    const projects = readProjects();
    if (!projects[projectId]) return false;
    delete projects[projectId];
    saveProjects(projects);

    // Optionally cleanup workspace
    const dir = path.join(BIGBAG_WORKSPACES_DIR, projectId);
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (e) {
      console.warn("Could not delete directory:", dir, e);
    }
    return true;
  },
};
