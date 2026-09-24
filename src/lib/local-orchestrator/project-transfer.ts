import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import { zip, unzipSync } from "fflate";
import { localProjectStore } from "./project-store";
import { durableProjectStore } from "./durable-project-store";
import { e2bSandboxManager } from "./e2b-sandbox-manager";
import { slugify } from "@/lib/project-slug";
import type { LocalProjectRecord } from "./types";
import type { ProjectExportResult } from "@/lib/vcaas-types";

const EXPORTS_DIR = path.join(process.cwd(), "data", "exports");
const IGNORED_DIRS = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);

if (!fs.existsSync(EXPORTS_DIR)) {
  try {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  } catch (err) {
    console.warn("Could not create exports directory:", err);
  }
}

export const localProjectTransfer = {
  async exportProject(
    projectId: string,
    tenantId: string,
    options: { includeRecords: boolean }
  ): Promise<ProjectExportResult> {
    // 1. Ensure project workspace is hydrated
    await localProjectStore.hydrateProject(projectId, tenantId);

    const record = localProjectStore.getRecord(projectId);
    if (!record) {
      throw new Error("Project not found");
    }

    const workspaceDir = localProjectStore.getWorkspaceDir(projectId);
    const entries: Record<string, Uint8Array> = {};

    // 2. Walk workspace files
    async function walk(currentDir: string): Promise<void> {
      if (!fs.existsSync(currentDir)) return;
      const directoryEntries = await fs.promises.readdir(currentDir, {
        withFileTypes: true,
      });
      await Promise.all(
        directoryEntries.map(async (entry) => {
          if (IGNORED_DIRS.has(entry.name) || entry.isSymbolicLink()) return;
          const fullPath = path.join(currentDir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath);
          } else if (entry.isFile()) {
            const relPath = path.relative(workspaceDir, fullPath).replace(/\\/g, "/");
            const content = await fs.promises.readFile(fullPath);
            entries[`source/${relPath}`] = new Uint8Array(content);
          }
        })
      );
    }

    await walk(workspaceDir);

    // 3. Database collections & records
    const collections = await durableProjectStore.listAppCollections(projectId).catch(() => []);
    const databaseData: Array<{ name: string; records: unknown[] }> = [];

    for (const col of collections) {
      if (options.includeRecords) {
        const { records } = await durableProjectStore
          .listAppRecords(projectId, col.name, { limit: 10000 })
          .catch(() => ({ records: [] }));
        databaseData.push({ name: col.name, records });
      } else {
        databaseData.push({ name: col.name, records: [] });
      }
    }

    // 4. Manifest
    const manifest = {
      version: 1,
      sourceProjectId: projectId,
      label: record.label || projectId,
      description: record.description || "",
      projectContext: record.projectContext || null,
      requiresEndUserAuth: record.requiresEndUserAuth || false,
      exportedAt: new Date().toISOString(),
      includeRecords: options.includeRecords,
      database: databaseData,
    };

    entries["export-manifest.json"] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

    // 5. Create zip archive
    const archive = await new Promise<Uint8Array>((resolve, reject) => {
      zip(entries, { level: 6 }, (error, data) => {
        if (error) reject(error);
        else resolve(data);
      });
    });

    // 6. Generate importCode
    const safeSlug = (slugify(projectId) || "project").slice(0, 30);
    const codeHash = randomBytes(16).toString("hex");
    const importCode = `${safeSlug}-export-project-${codeHash}.zip`;

    // 7. Save bundle to disk and database
    if (!fs.existsSync(EXPORTS_DIR)) {
      fs.mkdirSync(EXPORTS_DIR, { recursive: true });
    }
    await fs.promises.writeFile(path.join(EXPORTS_DIR, importCode), archive);

    await durableProjectStore.saveProjectExport(importCode, projectId, archive).catch((err) => {
      console.warn("[localProjectTransfer] Could not save export to durable store:", err);
    });

    return {
      importCode,
      includeRecords: options.includeRecords,
      message: "Export created successfully",
    };
  },

  async loadBundle(importCode: string): Promise<Buffer | null> {
    const raw = importCode.trim();
    if (!raw) return null;

    // Try candidates: exact raw, with .zip, without .zip
    const candidates = [
      raw,
      raw.endsWith(".zip") ? raw.slice(0, -4) : `${raw}.zip`,
    ];

    // 1. Try disk
    for (const name of candidates) {
      const diskPath = path.join(EXPORTS_DIR, name);
      if (fs.existsSync(diskPath)) {
        try {
          return await fs.promises.readFile(diskPath);
        } catch {}
      }
    }

    // 2. Try durable store
    for (const name of candidates) {
      try {
        const dbBuffer = await durableProjectStore.loadProjectExport(name);
        if (dbBuffer) {
          // Cache to disk
          if (!fs.existsSync(EXPORTS_DIR)) {
            fs.mkdirSync(EXPORTS_DIR, { recursive: true });
          }
          await fs.promises.writeFile(path.join(EXPORTS_DIR, name), dbBuffer).catch(() => {});
          return dbBuffer;
        }
      } catch {}
    }

    return null;
  },

  async applyImport(targetProjectId: string, bundle: Buffer, _tenantId?: string): Promise<void> {
    const unzipped = unzipSync(new Uint8Array(bundle));

    // 1. Parse manifest
    let manifest: any = null;
    if (unzipped["export-manifest.json"]) {
      try {
        const text = new TextDecoder().decode(unzipped["export-manifest.json"]);
        manifest = JSON.parse(text);
      } catch (err) {
        console.warn("[localProjectTransfer] Could not parse export manifest:", err);
      }
    }

    // 2. Target workspace dir
    const workspaceDir = localProjectStore.getWorkspaceDir(targetProjectId);

    // Clean existing entries except node_modules and .next
    const existingEntries = await fs.promises.readdir(workspaceDir, { withFileTypes: true }).catch(() => []);
    for (const entry of existingEntries) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const fullPath = path.join(workspaceDir, entry.name);
      await fs.promises.rm(fullPath, { recursive: true, force: true }).catch(() => {});
    }

    // 3. Write files into target workspace
    for (const [relPath, content] of Object.entries(unzipped)) {
      if (relPath === "export-manifest.json" || relPath.endsWith("/")) continue;

      let targetRelPath = relPath;
      if (targetRelPath.startsWith("source/")) {
        targetRelPath = targetRelPath.slice("source/".length);
      }

      const normalized = targetRelPath.replace(/\\/g, "/");
      if (
        !normalized ||
        normalized.startsWith("/") ||
        normalized.split("/").includes("..") ||
        normalized.includes("\0")
      ) {
        continue;
      }

      const fullPath = path.join(workspaceDir, normalized);
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, content);
    }

    // 4. Restore database records if present
    if (manifest?.database && Array.isArray(manifest.database)) {
      for (const col of manifest.database) {
        const colName = col.name || col.collectionName;
        if (!colName || !Array.isArray(col.records)) continue;
        for (const record of col.records) {
          if (!record || typeof record !== "object") continue;
          const { _id, ...fields } = record as Record<string, unknown>;
          if (typeof _id === "string") {
            await durableProjectStore.upsertAppRecord(targetProjectId, colName, _id, fields, null).catch((err) => {
              console.warn(`[localProjectTransfer] Failed restoring record ${_id} in ${colName}:`, err);
            });
          }
        }
      }
    }

    // 5. Update target record metadata
    const patch: Partial<LocalProjectRecord> = {};
    if (manifest?.description) patch.description = manifest.description;
    if (manifest?.projectContext) patch.projectContext = manifest.projectContext;
    if (manifest?.requiresEndUserAuth !== undefined) patch.requiresEndUserAuth = manifest.requiresEndUserAuth;
    localProjectStore.update(targetProjectId, patch);

    // 6. Persist source
    await localProjectStore.persistSource(targetProjectId).catch((err) => {
      console.warn("[localProjectTransfer] Failed to persist source:", err);
    });

    // 7. Rebuild & start dev server
    await e2bSandboxManager.startDevServer(targetProjectId, { rebuild: true });

    // 8. Mark import completed
    localProjectStore.update(targetProjectId, {
      importInProgress: null,
      serverStatus: "Active",
    });
  },
};
