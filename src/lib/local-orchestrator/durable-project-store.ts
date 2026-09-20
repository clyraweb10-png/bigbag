import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { LocalProjectRecord } from "./types";

export type PersistedFile = { path: string; content: Uint8Array };
export type AppRecord = Record<string, unknown> & {
  _id: string;
  createdAt: string;
  updatedAt: string;
};

const SOURCE_IGNORED = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);
let pgPool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

const PERSISTENCE_ERROR =
  "Persistent project storage is not configured. Set SUPABASE_DATABASE_URL (or NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) before using the hosted local orchestrator.";

function getDatabaseUrl(): string | null {
  const url = process.env.SUPABASE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  return url || null;
}

function getPgPool(): Pool {
  const url = getDatabaseUrl();
  if (!url) {
    throw new Error(PERSISTENCE_ERROR);
  }
  if (!pgPool) {
    pgPool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pgPool;
}

async function ensureSchema(): Promise<Pool | null> {
  const url = getDatabaseUrl();
  if (!url) return null;

  if (!schemaReady) {
    const pool = getPgPool();
    schemaReady = (async () => {
      const client = await pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS public.builder_projects (
            project_id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            record_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS builder_projects_tenant_updated
            ON public.builder_projects (tenant_id, updated_at DESC);
          CREATE TABLE IF NOT EXISTS public.builder_project_files (
            project_id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            kind TEXT NOT NULL CHECK (kind IN ('source', 'deployment')),
            path TEXT NOT NULL,
            content BYTEA NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (project_id, kind, path),
            FOREIGN KEY (project_id) REFERENCES public.builder_projects(project_id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS builder_project_files_lookup
            ON public.builder_project_files (project_id, kind, path);
          CREATE TABLE IF NOT EXISTS public.builder_app_records (
            project_id TEXT NOT NULL,
            collection_name TEXT NOT NULL,
            record_id TEXT NOT NULL,
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (project_id, collection_name, record_id),
            FOREIGN KEY (project_id) REFERENCES public.builder_projects(project_id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS builder_app_records_collection
            ON public.builder_app_records (project_id, collection_name, updated_at DESC);
        `);
      } finally {
        client.release();
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return getPgPool();
}

async function requireSchema(): Promise<Pool> {
  const pool = await ensureSchema();
  if (!pool) throw new Error(PERSISTENCE_ERROR);
  return pool;
}

function assertSafeRelativePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..") ||
    normalized.includes("\0")
  ) {
    throw new Error(`Unsafe project file path: ${relativePath}`);
  }
  return normalized;
}

function rowText(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function rowBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof value === "string") {
    if (value.startsWith("\\x")) {
      return Buffer.from(value.slice(2), "hex");
    }
    return Buffer.from(value, "base64");
  }
  return Buffer.from(rowText(value));
}

export function assertAppCollectionName(value: string): string {
  const name = value.trim();
  if (!/^[a-z][a-z0-9_-]{0,63}$/i.test(name)) {
    throw new Error("Invalid collection name");
  }
  return name;
}

function appRecordFromRow(row: Record<string, unknown>): AppRecord {
  const parsed = JSON.parse(rowText(row.data_json)) as Record<string, unknown>;
  return {
    ...parsed,
    _id: rowText(row.record_id),
    createdAt: rowText(row.created_at),
    updatedAt: rowText(row.updated_at),
  };
}

function appRecordData(value: Record<string, unknown>): Record<string, unknown> {
  const data = { ...value };
  delete data._id;
  delete data.createdAt;
  delete data.updatedAt;
  return data;
}

export function durablePersistenceConfigured(): boolean {
  return getDatabaseUrl() !== null;
}

export function requireDurablePersistence(): void {
  if (!durablePersistenceConfigured()) {
    throw new Error(PERSISTENCE_ERROR);
  }
}

export function collectDirectoryFiles(root: string, ignored = SOURCE_IGNORED): PersistedFile[] {
  if (!fs.existsSync(root)) return [];
  const files: PersistedFile[] = [];
  const walk = (current: string): void => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) {
        files.push({
          path: assertSafeRelativePath(path.relative(root, fullPath)),
          content: fs.readFileSync(fullPath),
        });
      }
    }
  };
  walk(root);
  return files;
}

async function persistSnapshot(
  pool: Pool,
  record: LocalProjectRecord,
  kind: "source" | "deployment",
  files: PersistedFile[]
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ownerRes = await client.query(
      "SELECT tenant_id FROM public.builder_projects WHERE project_id = $1 LIMIT 1",
      [record.projectId]
    );
    if (ownerRes.rows[0] && rowText(ownerRes.rows[0].tenant_id) !== record.tenantId) {
      throw new Error("That project id is already owned by another tenant");
    }

    const updatedAt = new Date().toISOString();
    const upsertRes = await client.query(
      `INSERT INTO public.builder_projects (project_id, tenant_id, record_json, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id) DO UPDATE SET
         record_json = EXCLUDED.record_json,
         updated_at = EXCLUDED.updated_at
       WHERE builder_projects.tenant_id = EXCLUDED.tenant_id`,
      [record.projectId, record.tenantId, JSON.stringify(record), record.lastModifiedAt || updatedAt]
    );

    if (upsertRes.rowCount === 0) {
      throw new Error("That project id is already owned by another tenant");
    }

    await client.query(
      "DELETE FROM public.builder_project_files WHERE project_id = $1 AND tenant_id = $2 AND kind = $3",
      [record.projectId, record.tenantId, kind]
    );

    for (const file of files) {
      await client.query(
        `INSERT INTO public.builder_project_files
         (project_id, tenant_id, kind, path, content, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [record.projectId, record.tenantId, kind, assertSafeRelativePath(file.path), Buffer.from(file.content), updatedAt]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const durableProjectStore = {
  async saveRecord(record: LocalProjectRecord): Promise<void> {
    const pool = await ensureSchema();
    if (!pool) return;

    const res = await pool.query(
      `INSERT INTO public.builder_projects (project_id, tenant_id, record_json, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (project_id) DO UPDATE SET
         record_json = EXCLUDED.record_json,
         updated_at = EXCLUDED.updated_at
       WHERE builder_projects.tenant_id = EXCLUDED.tenant_id`,
      [record.projectId, record.tenantId, JSON.stringify(record), record.lastModifiedAt || new Date().toISOString()]
    );
    if (res.rowCount === 0) {
      throw new Error("That project id is already owned by another tenant");
    }
  },

  async projectIdExists(projectId: string): Promise<boolean> {
    const pool = await ensureSchema();
    if (!pool) return false;

    const res = await pool.query(
      "SELECT 1 FROM public.builder_projects WHERE project_id = $1 LIMIT 1",
      [projectId]
    );
    return (res.rowCount ?? 0) > 0;
  },

  async loadRecord(projectId: string, tenantId: string): Promise<LocalProjectRecord | null> {
    const pool = await ensureSchema();
    if (!pool) return null;

    const res = await pool.query(
      "SELECT record_json FROM public.builder_projects WHERE project_id = $1 AND tenant_id = $2 LIMIT 1",
      [projectId, tenantId]
    );
    if (!res.rows[0]) return null;
    const parsed = JSON.parse(rowText(res.rows[0].record_json)) as LocalProjectRecord;
    return parsed.tenantId === tenantId ? parsed : null;
  },

  async listRecords(tenantId: string): Promise<LocalProjectRecord[]> {
    const pool = await ensureSchema();
    if (!pool) return [];

    const res = await pool.query(
      "SELECT record_json FROM public.builder_projects WHERE tenant_id = $1 ORDER BY updated_at DESC",
      [tenantId]
    );
    return res.rows
      .map((row) => JSON.parse(rowText(row.record_json)) as LocalProjectRecord)
      .filter((record) => record.tenantId === tenantId);
  },

  async saveSource(record: LocalProjectRecord, workspaceDir: string): Promise<void> {
    const files = collectDirectoryFiles(workspaceDir);
    const pool = await ensureSchema();
    if (!pool) return;
    await persistSnapshot(pool, record, "source", files);
  },

  async saveDeployment(record: LocalProjectRecord, files: PersistedFile[]): Promise<void> {
    if (files.length === 0) throw new Error("The successful build produced no deployment files");
    const pool = await ensureSchema();
    if (!pool) return;
    await persistSnapshot(pool, record, "deployment", files);
  },

  async restoreSource(projectId: string, tenantId: string, workspaceDir: string): Promise<number> {
    const pool = await ensureSchema();
    if (!pool) return 0;

    const res = await pool.query(
      `SELECT files.path, files.content
       FROM public.builder_project_files AS files
       INNER JOIN public.builder_projects AS projects
         ON projects.project_id = files.project_id AND projects.tenant_id = files.tenant_id
       WHERE files.project_id = $1 AND files.tenant_id = $2 AND files.kind = 'source'
       ORDER BY files.path`,
      [projectId, tenantId]
    );

    if (res.rows.length === 0) return 0;

    const resolvedWorkspace = path.resolve(workspaceDir);
    const parent = path.dirname(resolvedWorkspace);
    const name = path.basename(resolvedWorkspace);
    fs.mkdirSync(parent, { recursive: true });
    const staging = fs.mkdtempSync(path.join(parent, `.${name}.restore-`));
    let backup: string | null = null;
    const preserved: string[] = [];

    try {
      for (const row of res.rows) {
        const relativePath = assertSafeRelativePath(rowText(row.path));
        const fullPath = path.join(staging, relativePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, rowBytes(row.content));
      }

      if (fs.existsSync(resolvedWorkspace)) {
        backup = fs.mkdtempSync(path.join(parent, `.${name}.backup-`));
        fs.rmdirSync(backup);
        fs.renameSync(resolvedWorkspace, backup);
        for (const entry of fs.readdirSync(/* turbopackIgnore: true */ backup, { withFileTypes: true })) {
          if (!SOURCE_IGNORED.has(entry.name) || entry.isSymbolicLink()) continue;
          fs.renameSync(
            path.join(/* turbopackIgnore: true */ backup, entry.name),
            path.join(staging, entry.name)
          );
          preserved.push(entry.name);
        }
      }

      fs.renameSync(staging, resolvedWorkspace);
      if (backup) {
        try {
          fs.rmSync(backup, { recursive: true, force: true });
        } catch (error) {
          console.warn(`[project-store] Restored ${projectId}, but could not remove its backup:`, error);
        }
      }
    } catch (error) {
      if (backup) {
        for (const entryName of preserved) {
          const stagedEntry = path.join(staging, entryName);
          if (fs.existsSync(stagedEntry)) {
            fs.renameSync(stagedEntry, path.join(/* turbopackIgnore: true */ backup, entryName));
          }
        }
        if (!fs.existsSync(resolvedWorkspace)) fs.renameSync(backup, resolvedWorkspace);
      }
      throw error;
    } finally {
      if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    }
    return res.rows.length;
  },

  async readDeploymentFile(projectId: string, requestedPath: string): Promise<PersistedFile | null> {
    const pool = await ensureSchema();
    if (!pool) return null;
    const normalized = assertSafeRelativePath(requestedPath || "index.html");

    const res = await pool.query(
      `SELECT files.path, files.content
       FROM public.builder_project_files AS files
       INNER JOIN public.builder_projects AS projects
         ON projects.project_id = files.project_id AND projects.tenant_id = files.tenant_id
       WHERE files.project_id = $1 AND files.kind = 'deployment' AND files.path = $2 LIMIT 1`,
      [projectId, normalized]
    );
    const row = res.rows[0];
    return row ? { path: rowText(row.path), content: rowBytes(row.content) } : null;
  },

  async readPublicSourceFile(projectId: string, requestedPath: string): Promise<PersistedFile | null> {
    const pool = await ensureSchema();
    if (!pool) return null;
    const normalized = assertSafeRelativePath(requestedPath);
    if (!normalized.startsWith("public/")) return null;

    const res = await pool.query(
      `SELECT files.path, files.content
       FROM public.builder_project_files AS files
       INNER JOIN public.builder_projects AS projects
         ON projects.project_id = files.project_id AND projects.tenant_id = files.tenant_id
       WHERE files.project_id = $1 AND files.kind = 'source' AND files.path = $2 LIMIT 1`,
      [projectId, normalized]
    );
    const row = res.rows[0];
    return row ? { path: rowText(row.path), content: rowBytes(row.content) } : null;
  },

  async listAppCollections(projectId: string): Promise<Array<{ name: string; count: number }>> {
    const pool = await requireSchema();
    const res = await pool.query(
      `SELECT records.collection_name, COUNT(*) AS record_count
       FROM public.builder_app_records AS records
       INNER JOIN public.builder_projects AS projects ON projects.project_id = records.project_id
       WHERE records.project_id = $1
       GROUP BY records.collection_name ORDER BY records.collection_name`,
      [projectId]
    );
    return res.rows.map((row) => ({
      name: rowText(row.collection_name),
      count: Number(row.record_count) || 0,
    }));
  },

  async listAppRecords(
    projectId: string,
    collectionName: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ records: AppRecord[]; total: number }> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));

    const [rowsRes, countRes] = await Promise.all([
      pool.query(
        `SELECT record_id, data_json, created_at, updated_at
         FROM public.builder_app_records
         WHERE project_id = $1 AND collection_name = $2
         ORDER BY updated_at DESC LIMIT $3 OFFSET $4`,
        [projectId, collection, limit, offset]
      ),
      pool.query(
        `SELECT COUNT(*) AS record_count FROM public.builder_app_records
         WHERE project_id = $1 AND collection_name = $2`,
        [projectId, collection]
      ),
    ]);
    return {
      records: rowsRes.rows.map((row) => appRecordFromRow(row as Record<string, unknown>)),
      total: Number(countRes.rows[0]?.record_count) || 0,
    };
  },

  async listAllAppRecords(projectId: string, collectionName: string): Promise<AppRecord[]> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);

    const res = await pool.query(
      `SELECT record_id, data_json, created_at, updated_at
       FROM public.builder_app_records
       WHERE project_id = $1 AND collection_name = $2
       ORDER BY updated_at DESC`,
      [projectId, collection]
    );
    return res.rows.map((row) => appRecordFromRow(row as Record<string, unknown>));
  },

  async getAppRecord(projectId: string, collectionName: string, recordId: string): Promise<AppRecord | null> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);

    const res = await pool.query(
      `SELECT record_id, data_json, created_at, updated_at
       FROM public.builder_app_records
       WHERE project_id = $1 AND collection_name = $2 AND record_id = $3 LIMIT 1`,
      [projectId, collection, recordId]
    );
    const row = res.rows[0];
    return row ? appRecordFromRow(row as Record<string, unknown>) : null;
  },

  async createAppRecord(
    projectId: string,
    collectionName: string,
    value: Record<string, unknown>
  ): Promise<AppRecord> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const recordId = randomUUID();
    const now = new Date().toISOString();
    const data = appRecordData(value);

    const res = await pool.query(
      `INSERT INTO public.builder_app_records
       (project_id, collection_name, record_id, data_json, created_at, updated_at)
       SELECT project_id, $1, $2, $3, $4, $5 FROM public.builder_projects WHERE project_id = $6`,
      [collection, recordId, JSON.stringify(data), now, now, projectId]
    );
    if ((res.rowCount ?? 0) !== 1) throw new Error("Project not found");
    return { ...data, _id: recordId, createdAt: now, updatedAt: now };
  },

  async updateAppRecord(
    projectId: string,
    collectionName: string,
    recordId: string,
    patch: Record<string, unknown>
  ): Promise<AppRecord | null> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `SELECT record_id, data_json, created_at, updated_at
         FROM public.builder_app_records
         WHERE project_id = $1 AND collection_name = $2 AND record_id = $3 LIMIT 1`,
        [projectId, collection, recordId]
      );
      const row = res.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return null;
      }

      const current = appRecordFromRow(row as Record<string, unknown>);
      const data = appRecordData({ ...current, ...patch });
      const updatedAt = new Date().toISOString();

      const updateRes = await client.query(
        `UPDATE public.builder_app_records SET data_json = $1, updated_at = $2
         WHERE project_id = $3 AND collection_name = $4 AND record_id = $5`,
        [JSON.stringify(data), updatedAt, projectId, collection, recordId]
      );

      if ((updateRes.rowCount ?? 0) !== 1) {
        await client.query("ROLLBACK");
        return null;
      }

      await client.query("COMMIT");
      return { ...data, _id: recordId, createdAt: current.createdAt, updatedAt };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

  async deleteAppRecord(projectId: string, collectionName: string, recordId: string): Promise<boolean> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);

    const res = await pool.query(
      `DELETE FROM public.builder_app_records
       WHERE project_id = $1 AND collection_name = $2 AND record_id = $3`,
      [projectId, collection, recordId]
    );
    return (res.rowCount ?? 0) > 0;
  },

  async remove(projectId: string, tenantId: string): Promise<boolean> {
    const pool = await ensureSchema();
    if (!pool) return false;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM public.builder_project_files WHERE project_id = $1 AND tenant_id = $2",
        [projectId, tenantId]
      );
      await client.query(
        `DELETE FROM public.builder_app_records WHERE project_id = $1
         AND EXISTS (SELECT 1 FROM public.builder_projects WHERE project_id = $1 AND tenant_id = $2)`,
        [projectId, tenantId]
      );
      const res = await client.query(
        "DELETE FROM public.builder_projects WHERE project_id = $1 AND tenant_id = $2",
        [projectId, tenantId]
      );
      await client.query("COMMIT");
      return (res.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};
