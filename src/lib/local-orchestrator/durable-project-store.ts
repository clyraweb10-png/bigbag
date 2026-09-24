import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type { LocalProjectRecord } from "./types";
import { qualificationProjectId } from "../qualification-run";

export type PersistedFile = { path: string; content: Uint8Array };
export type AppRecord = Record<string, unknown> & {
  _id: string;
  createdAt: string;
  updatedAt: string;
};
export type QualificationEvidence = Record<string, unknown> & {
  projectNumber: number;
  projectName: string;
  category: string;
  projectId: string;
  generationId: string;
  statuses: { final?: string };
};

const SOURCE_IGNORED = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);
const PREVIEW_AUTH_STORAGE_TTL_MS = 30 * 24 * 60 * 60_000;
const MAX_PREVIEW_AUTH_SESSIONS_PER_PROJECT = 100_000;
const PREVIEW_AUTH_GLOBAL_PURGE_BATCH = 1_000;
let pgPool: Pool | null = null;
let schemaReady: Promise<void> | null = null;

const PERSISTENCE_ERROR =
  "Persistent project storage is not configured. Please set SUPABASE_DATABASE_URL (or DATABASE_URL) in your Render Environment settings.";

function getDatabaseUrl(): string | null {
  const direct =
    process.env.SUPABASE_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.POSTGRES_URL?.trim() ||
    process.env.POSTGRES_PRISMA_URL?.trim();
  if (direct) return direct;

  const pwd = process.env.SUPABASE_DB_PASSWORD?.trim();
  if (pwd) {
    let ref = process.env.SUPABASE_PROJECT_REF?.trim();
    if (!ref && process.env.NEXT_PUBLIC_SUPABASE_URL) {
      try {
        const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname;
        ref = host.split(".")[0];
      } catch {}
    }
    if (ref) {
      const region = process.env.SUPABASE_REGION?.trim() || "aws-0-ap-southeast-1";
      return `postgresql://postgres.${ref}:${encodeURIComponent(pwd)}@${region}.pooler.supabase.com:6543/postgres`;
    }
  }

  return null;
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
            owner_id TEXT,
            data_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (project_id, collection_name, record_id),
            FOREIGN KEY (project_id) REFERENCES public.builder_projects(project_id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS builder_app_records_collection
            ON public.builder_app_records (project_id, collection_name, updated_at DESC);
          ALTER TABLE public.builder_app_records ADD COLUMN IF NOT EXISTS owner_id TEXT;
          CREATE INDEX IF NOT EXISTS builder_app_records_owner
            ON public.builder_app_records (project_id, collection_name, owner_id, updated_at DESC);
          CREATE TABLE IF NOT EXISTS public.builder_preview_auth_storage (
            project_id TEXT NOT NULL,
            guest_id TEXT NOT NULL,
            storage_key TEXT NOT NULL,
            sealed_value TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (project_id, guest_id, storage_key),
            FOREIGN KEY (project_id) REFERENCES public.builder_projects(project_id) ON DELETE CASCADE
          );
          CREATE INDEX IF NOT EXISTS builder_preview_auth_storage_updated
            ON public.builder_preview_auth_storage (updated_at);
          CREATE TABLE IF NOT EXISTS public.builder_qualification_results (
            run_id TEXT NOT NULL,
            project_number INTEGER NOT NULL,
            category TEXT NOT NULL,
            project_id TEXT NOT NULL,
            generation_id TEXT NOT NULL,
            final_status TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (run_id, project_number)
          );
          CREATE INDEX IF NOT EXISTS builder_qualification_results_updated
            ON public.builder_qualification_results (updated_at DESC);
          CREATE TABLE IF NOT EXISTS public.builder_qualification_history (
            history_id TEXT PRIMARY KEY,
            attempt_order BIGSERIAL NOT NULL,
            run_id TEXT NOT NULL,
            project_number INTEGER NOT NULL,
            project_id TEXT NOT NULL,
            generation_id TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            recorded_at TEXT NOT NULL
          );
          ALTER TABLE public.builder_qualification_history ADD COLUMN IF NOT EXISTS attempt_order BIGSERIAL;
          CREATE UNIQUE INDEX IF NOT EXISTS builder_qualification_history_order
            ON public.builder_qualification_history (attempt_order);
          CREATE INDEX IF NOT EXISTS builder_qualification_history_project_order
            ON public.builder_qualification_history (run_id, project_number, attempt_order ASC);
          INSERT INTO public.builder_qualification_history
            (history_id, run_id, project_number, project_id, generation_id, evidence_json, recorded_at)
          SELECT md5(result.run_id || ':' || result.project_number::text || ':' || result.evidence_json),
            result.run_id, result.project_number, result.project_id, result.generation_id,
            result.evidence_json, result.updated_at
          FROM public.builder_qualification_results AS result
          WHERE NOT EXISTS (
            SELECT 1 FROM public.builder_qualification_history AS history
            WHERE history.run_id = result.run_id AND history.project_number = result.project_number
              AND history.evidence_json = result.evidence_json
          )
          ON CONFLICT (history_id) DO NOTHING;
          CREATE TABLE IF NOT EXISTS public.builder_qualification_benchmarks (
            run_id TEXT NOT NULL,
            benchmark_key TEXT NOT NULL,
            evidence_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (run_id, benchmark_key)
          );
          CREATE TABLE IF NOT EXISTS public.builder_project_exports (
            import_code TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            bundle BYTEA NOT NULL,
            created_at TEXT NOT NULL
          );
          CREATE INDEX IF NOT EXISTS builder_project_exports_created
            ON public.builder_project_exports (created_at DESC);
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
  files: PersistedFile[],
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    signal?.throwIfAborted();
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
      signal?.throwIfAborted();
      await client.query(
        `INSERT INTO public.builder_project_files
         (project_id, tenant_id, kind, path, content, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [record.projectId, record.tenantId, kind, assertSafeRelativePath(file.path), Buffer.from(file.content), updatedAt]
      );
    }

    // Cancellation before commit must roll back the entire deployment rather
    // than replace the previous working artifact with a stopped generation.
    signal?.throwIfAborted();
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

  async loadRecordByProjectId(projectId: string): Promise<LocalProjectRecord | null> {
    const pool = await ensureSchema();
    if (!pool) return null;
    const res = await pool.query(
      "SELECT record_json FROM public.builder_projects WHERE project_id = $1 LIMIT 1",
      [projectId]
    );
    return res.rows[0]
      ? JSON.parse(rowText(res.rows[0].record_json)) as LocalProjectRecord
      : null;
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

  async saveDeployment(record: LocalProjectRecord, files: PersistedFile[], signal?: AbortSignal): Promise<void> {
    if (files.length === 0) throw new Error("The successful build produced no deployment files");
    const pool = await ensureSchema();
    if (!pool) return;
    await persistSnapshot(pool, record, "deployment", files, signal);
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
    options: { limit?: number; offset?: number; ownerId?: string } = {}
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
           AND ($5::text IS NULL OR owner_id = $5)
         ORDER BY updated_at DESC LIMIT $3 OFFSET $4`,
        [projectId, collection, limit, offset, options.ownerId || null]
      ),
      pool.query(
        `SELECT COUNT(*) AS record_count FROM public.builder_app_records
         WHERE project_id = $1 AND collection_name = $2
           AND ($3::text IS NULL OR owner_id = $3)`,
        [projectId, collection, options.ownerId || null]
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

  async getAppRecord(projectId: string, collectionName: string, recordId: string, ownerId?: string): Promise<AppRecord | null> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);

    const res = await pool.query(
      `SELECT record_id, data_json, created_at, updated_at
       FROM public.builder_app_records
       WHERE project_id = $1 AND collection_name = $2 AND record_id = $3
         AND ($4::text IS NULL OR owner_id = $4) LIMIT 1`,
      [projectId, collection, recordId, ownerId || null]
    );
    const row = res.rows[0];
    return row ? appRecordFromRow(row as Record<string, unknown>) : null;
  },

  async createAppRecord(
    projectId: string,
    collectionName: string,
    value: Record<string, unknown>,
    ownerId?: string
  ): Promise<AppRecord> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const recordId = randomUUID();
    const now = new Date().toISOString();
    const data = appRecordData(value);

    const res = await pool.query(
      `INSERT INTO public.builder_app_records
       (project_id, collection_name, record_id, owner_id, data_json, created_at, updated_at)
       SELECT project_id, $1, $2, $3, $4, $5, $6 FROM public.builder_projects WHERE project_id = $7`,
      [collection, recordId, ownerId || null, JSON.stringify(data), now, now, projectId]
    );
    if ((res.rowCount ?? 0) !== 1) throw new Error("Project not found");
    return { ...data, _id: recordId, createdAt: now, updatedAt: now };
  },

  async upsertAppRecord(
    projectId: string,
    collectionName: string,
    recordId: string,
    value: Record<string, unknown>,
    ownerId?: string | null
  ): Promise<AppRecord> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const now = new Date().toISOString();
    const data = appRecordData(value);

    await pool.query(
      `INSERT INTO public.builder_app_records
       (project_id, collection_name, record_id, owner_id, data_json, created_at, updated_at)
       SELECT project_id, $1, $2, $3, $4, $5, $6 FROM public.builder_projects WHERE project_id = $7
       ON CONFLICT (project_id, collection_name, record_id)
       DO UPDATE SET data_json = EXCLUDED.data_json, updated_at = EXCLUDED.updated_at`,
      [collection, recordId, ownerId || null, JSON.stringify(data), now, now, projectId]
    );
    return { ...data, _id: recordId, createdAt: now, updatedAt: now };
  },

  async updateAppRecord(
    projectId: string,
    collectionName: string,
    recordId: string,
    patch: Record<string, unknown>,
    ownerId?: string
  ): Promise<AppRecord | null> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `SELECT record_id, data_json, created_at, updated_at
         FROM public.builder_app_records
         WHERE project_id = $1 AND collection_name = $2 AND record_id = $3
           AND ($4::text IS NULL OR owner_id = $4) LIMIT 1`,
        [projectId, collection, recordId, ownerId || null]
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
         WHERE project_id = $3 AND collection_name = $4 AND record_id = $5
           AND ($6::text IS NULL OR owner_id = $6)`,
        [JSON.stringify(data), updatedAt, projectId, collection, recordId, ownerId || null]
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

  async deleteAppRecord(projectId: string, collectionName: string, recordId: string, ownerId?: string): Promise<boolean> {
    const pool = await requireSchema();
    const collection = assertAppCollectionName(collectionName);

    const res = await pool.query(
      `DELETE FROM public.builder_app_records
       WHERE project_id = $1 AND collection_name = $2 AND record_id = $3
         AND ($4::text IS NULL OR owner_id = $4)`,
      [projectId, collection, recordId, ownerId || null]
    );
    return (res.rowCount ?? 0) > 0;
  },

  async readPreviewAuthStorage(projectId: string, guestId: string, storageKey: string): Promise<string | null> {
    const pool = await requireSchema();
    const activeSince = new Date(Date.now() - PREVIEW_AUTH_STORAGE_TTL_MS).toISOString();
    const res = await pool.query(
      `SELECT sealed_value FROM public.builder_preview_auth_storage
       WHERE project_id = $1 AND guest_id = $2 AND storage_key = $3 AND updated_at >= $4 LIMIT 1`,
      [projectId, guestId, storageKey, activeSince]
    );
    return res.rows[0] ? rowText(res.rows[0].sealed_value) : null;
  },

  async writePreviewAuthStorage(
    projectId: string,
    guestId: string,
    storageKey: string,
    sealedValue: string
  ): Promise<void> {
    const pool = await requireSchema();
    const now = new Date().toISOString();
    const activeSince = new Date(Date.now() - PREVIEW_AUTH_STORAGE_TTL_MS).toISOString();
    await pool.query(
      `DELETE FROM public.builder_preview_auth_storage
       WHERE updated_at < $1 AND (project_id, guest_id, storage_key) IN (
         SELECT project_id, guest_id, storage_key
         FROM public.builder_preview_auth_storage
         WHERE updated_at < $1
         ORDER BY updated_at ASC
         LIMIT $2
       )`,
      [activeSince, PREVIEW_AUTH_GLOBAL_PURGE_BATCH]
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [projectId, "preview-auth"]);
      await client.query(
        "DELETE FROM public.builder_preview_auth_storage WHERE project_id = $1 AND updated_at < $2",
        [projectId, activeSince]
      );
      const existing = await client.query(
        `SELECT 1 FROM public.builder_preview_auth_storage
         WHERE project_id = $1 AND guest_id = $2 AND storage_key = $3 LIMIT 1`,
        [projectId, guestId, storageKey]
      );
      if ((existing.rowCount ?? 0) === 0) {
        const count = await client.query(
          "SELECT COUNT(*)::int AS count FROM public.builder_preview_auth_storage WHERE project_id = $1",
          [projectId]
        );
        if (Number(count.rows[0]?.count || 0) >= MAX_PREVIEW_AUTH_SESSIONS_PER_PROJECT) {
          throw new Error("Preview authentication session capacity reached");
        }
      }
      const res = await client.query(
        `INSERT INTO public.builder_preview_auth_storage
         (project_id, guest_id, storage_key, sealed_value, updated_at)
         SELECT project_id, $2, $3, $4, $5 FROM public.builder_projects WHERE project_id = $1
         ON CONFLICT (project_id, guest_id, storage_key) DO UPDATE SET
           sealed_value = EXCLUDED.sealed_value,
           updated_at = EXCLUDED.updated_at`,
        [projectId, guestId, storageKey, sealedValue, now]
      );
      if ((res.rowCount ?? 0) !== 1) throw new Error("Project not found");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

  async deletePreviewAuthStorage(projectId: string, guestId: string, storageKey: string): Promise<boolean> {
    const pool = await requireSchema();
    const res = await pool.query(
      `DELETE FROM public.builder_preview_auth_storage
       WHERE project_id = $1 AND guest_id = $2 AND storage_key = $3`,
      [projectId, guestId, storageKey]
    );
    return (res.rowCount ?? 0) > 0;
  },

  async saveQualificationEvidence(runId: string, evidence: QualificationEvidence): Promise<void> {
    const pool = await requireSchema();
    if (!/^[a-z0-9-]{1,120}$/i.test(runId)) throw new Error("Invalid qualification run id");
    if (!Number.isInteger(evidence.projectNumber) || evidence.projectNumber < 1 || evidence.projectNumber > 100) {
      throw new Error("Invalid qualification project number");
    }
    const updatedAt = new Date().toISOString();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text), 0)", [runId]);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text), $2::integer)", [runId, evidence.projectNumber]);
      const saveSnapshot = async (projectId: string, generationId: string, evidenceJson: string, recordedAt: string) => {
        await client.query(
          `INSERT INTO public.builder_qualification_history
           (history_id, run_id, project_number, project_id, generation_id, evidence_json, recorded_at)
           SELECT $1, $2, $3, $4, $5, $6, $7
           WHERE $6 IS DISTINCT FROM (
             SELECT evidence_json FROM public.builder_qualification_history
             WHERE run_id = $2 AND project_number = $3 ORDER BY attempt_order DESC LIMIT 1
           )`,
          [randomUUID(), runId, evidence.projectNumber, projectId, generationId, evidenceJson, recordedAt]
        );
      };
      const existing = await client.query(
        `SELECT project_id, generation_id, evidence_json, updated_at
         FROM public.builder_qualification_results
         WHERE run_id = $1 AND project_number = $2 FOR UPDATE`,
        [runId, evidence.projectNumber]
      );
      if (existing.rows[0]) {
        const prior = existing.rows[0];
        await saveSnapshot(prior.project_id, prior.generation_id, prior.evidence_json, prior.updated_at);
      }
      await saveSnapshot(evidence.projectId, evidence.generationId, JSON.stringify(evidence), updatedAt);
      await client.query(
        `INSERT INTO public.builder_qualification_results
       (run_id, project_number, category, project_id, generation_id, final_status, evidence_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (run_id, project_number) DO UPDATE SET
         category = EXCLUDED.category,
         project_id = EXCLUDED.project_id,
         generation_id = EXCLUDED.generation_id,
         final_status = EXCLUDED.final_status,
         evidence_json = EXCLUDED.evidence_json,
         updated_at = EXCLUDED.updated_at`,
        [runId, evidence.projectNumber, evidence.category, evidence.projectId, evidence.generationId,
          evidence.statuses.final || "FAIL", JSON.stringify(evidence), updatedAt]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

  async listQualificationAttemptHistory(runId: string, projectNumber: number): Promise<QualificationEvidence[]> {
    const pool = await requireSchema();
    if (!/^[a-z0-9-]{1,120}$/i.test(runId) || !Number.isInteger(projectNumber) || projectNumber < 1 || projectNumber > 100) {
      throw new Error("Invalid qualification history identity");
    }
    const res = await pool.query(
      `SELECT evidence_json FROM public.builder_qualification_history
       WHERE run_id = $1 AND project_number = $2 ORDER BY attempt_order ASC`,
      [runId, projectNumber]
    );
    return res.rows.map((row) => JSON.parse(rowText(row.evidence_json)) as QualificationEvidence);
  },

  async listQualificationEvidence(runId?: string): Promise<{ runId: string | null; results: QualificationEvidence[] }> {
    const pool = await requireSchema();
    const selectedRun = runId || rowText((await pool.query(
      "SELECT run_id FROM public.builder_qualification_results ORDER BY updated_at DESC LIMIT 1"
    )).rows[0]?.run_id);
    if (!selectedRun) return { runId: null, results: [] };
    const res = await pool.query(
      `SELECT evidence_json FROM public.builder_qualification_results
       WHERE run_id = $1 ORDER BY project_number ASC`,
      [selectedRun]
    );
    return {
      runId: selectedRun,
      results: res.rows.map((row) => JSON.parse(rowText(row.evidence_json)) as QualificationEvidence),
    };
  },

  async listQualificationProjectAttempts(runId: string, projectNumber: number): Promise<LocalProjectRecord[]> {
    const prefix = qualificationProjectId(runId, projectNumber);
    const pool = await requireSchema();
    const res = await pool.query(
      `SELECT project_id, record_json FROM public.builder_projects
       WHERE project_id = $1 OR project_id LIKE $2`,
      [prefix, `${prefix}-%`]
    );
    const records = res.rows.map((row) => JSON.parse(rowText(row.record_json)) as LocalProjectRecord);
    const legacyRetries = records.filter((record) => !record.qualificationRunId && record.projectId !== prefix &&
      record.projectId.startsWith(`${prefix}-`) && /^\d+$/.test(record.projectId.slice(prefix.length + 1)));
    const referencedIds = new Set<string>();
    const ambiguousBase = /-\d+$/.test(runId) && records.some((record) => !record.qualificationRunId && record.projectId === prefix);
    if (legacyRetries.length > 0 || ambiguousBase) {
      const evidenceRes = await pool.query(
        `SELECT evidence_json FROM public.builder_qualification_results
         WHERE run_id = $1 AND project_number = $2`,
        [runId, projectNumber]
      );
      if (evidenceRes.rows[0]) {
        const evidence = JSON.parse(rowText(evidenceRes.rows[0].evidence_json)) as QualificationEvidence & {
          priorCampaignAttempts?: Array<{ projectId?: string }>;
        };
        referencedIds.add(evidence.projectId);
        for (const attempt of evidence.priorCampaignAttempts || []) {
          if (typeof attempt.projectId === "string") referencedIds.add(attempt.projectId);
        }
      }
    }
    return records
      .filter((record) => record.qualificationRunId
        ? record.qualificationRunId === runId && (record.projectId === prefix ||
          (record.projectId.startsWith(`${prefix}-`) && /^\d+$/.test(record.projectId.slice(prefix.length + 1))))
        : (record.projectId === prefix && (!ambiguousBase || referencedIds.has(prefix))) || referencedIds.has(record.projectId))
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  },

  async reserveQualificationProjectId(record: LocalProjectRecord): Promise<boolean> {
    const match = /^qualification-p(\d+)-/.exec(record.projectId);
    const prefix = qualificationProjectId(record.qualificationRunId || "", Number(match?.[1]));
    if (record.projectId !== prefix && !(record.projectId.startsWith(`${prefix}-`) &&
      /^\d+$/.test(record.projectId.slice(prefix.length + 1)))) {
      throw new Error("Invalid qualification project identity");
    }
    const pool = await requireSchema();
    const res = await pool.query(
      `INSERT INTO public.builder_projects (project_id, tenant_id, record_json, updated_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT (project_id) DO NOTHING`,
      [record.projectId, record.tenantId, JSON.stringify(record), record.lastModifiedAt || record.createdAt]
    );
    return res.rowCount === 1;
  },

  async removeQualificationRun(runId: string): Promise<number> {
    const pool = await requireSchema();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1::text), 0)", [runId]);
      await client.query("DELETE FROM public.builder_qualification_benchmarks WHERE run_id = $1", [runId]);
      await client.query("DELETE FROM public.builder_qualification_history WHERE run_id = $1", [runId]);
      const res = await client.query("DELETE FROM public.builder_qualification_results WHERE run_id = $1", [runId]);
      await client.query("COMMIT");
      return res.rowCount ?? 0;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },

  async saveQualificationBenchmark(runId: string, key: string, evidence: Record<string, unknown>): Promise<void> {
    const pool = await requireSchema();
    if (!/^[a-z0-9-]{1,120}$/i.test(runId) || !/^[a-z0-9-]{1,80}$/i.test(key)) {
      throw new Error("Invalid qualification benchmark identity");
    }
    await pool.query(
      `INSERT INTO public.builder_qualification_benchmarks (run_id, benchmark_key, evidence_json, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (run_id, benchmark_key) DO UPDATE SET
         evidence_json = EXCLUDED.evidence_json,
         updated_at = EXCLUDED.updated_at`,
      [runId, key, JSON.stringify(evidence), new Date().toISOString()]
    );
  },

  async listQualificationBenchmarks(runId: string): Promise<Record<string, Record<string, unknown>>> {
    const pool = await requireSchema();
    const res = await pool.query(
      "SELECT benchmark_key, evidence_json FROM public.builder_qualification_benchmarks WHERE run_id = $1",
      [runId]
    );
    return Object.fromEntries(res.rows.map((row) => [
      rowText(row.benchmark_key),
      JSON.parse(rowText(row.evidence_json)) as Record<string, unknown>,
    ]));
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

  async saveProjectExport(importCode: string, projectId: string, bundle: Uint8Array | Buffer): Promise<void> {
    const pool = await ensureSchema();
    if (!pool) return;
    await pool.query(
      `INSERT INTO public.builder_project_exports (import_code, project_id, bundle, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (import_code) DO UPDATE SET bundle = EXCLUDED.bundle, created_at = EXCLUDED.created_at`,
      [importCode, projectId, Buffer.from(bundle), new Date().toISOString()]
    );
  },

  async loadProjectExport(importCode: string): Promise<Buffer | null> {
    const pool = await ensureSchema();
    if (!pool) return null;
    const res = await pool.query<{ bundle: Buffer }>(
      `SELECT bundle FROM public.builder_project_exports WHERE import_code = $1 LIMIT 1`,
      [importCode]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0].bundle;
  },
};
