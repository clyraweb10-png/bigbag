import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type Client, type InStatement } from "@libsql/client";
import type { LocalProjectRecord } from "./types";

export type PersistedFile = { path: string; content: Uint8Array };
export type AppRecord = Record<string, unknown> & {
  _id: string;
  createdAt: string;
  updatedAt: string;
};

const SOURCE_IGNORED = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);
let client: Client | null = null;
let schemaReady: Promise<void> | null = null;
const PERSISTENCE_ERROR =
  "Persistent project storage is not configured. Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before using the hosted local orchestrator.";

function databaseConfig(): { url: string; authToken?: string } | null {
  const url = process.env.TURSO_DATABASE_URL?.trim();
  if (!url) return null;
  const authToken = process.env.TURSO_AUTH_TOKEN?.trim();
  if (url.startsWith("libsql:") && !authToken) return null;
  return { url, authToken: authToken || undefined };
}

function getClient(): Client | null {
  const config = databaseConfig();
  if (!config) return null;
  if (!client) client = createClient(config);
  return client;
}

async function ensureSchema(): Promise<Client | null> {
  const db = getClient();
  if (!db) return null;
  if (!schemaReady) {
    schemaReady = db.batch(
      [
        `CREATE TABLE IF NOT EXISTS builder_projects (
          project_id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL,
          record_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`,
        `CREATE INDEX IF NOT EXISTS builder_projects_tenant_updated
          ON builder_projects (tenant_id, updated_at DESC)`,
        `CREATE TABLE IF NOT EXISTS builder_project_files (
          project_id TEXT NOT NULL,
          tenant_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('source', 'deployment')),
          path TEXT NOT NULL,
          content BLOB NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (project_id, kind, path),
          FOREIGN KEY (project_id) REFERENCES builder_projects(project_id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS builder_project_files_lookup
          ON builder_project_files (project_id, kind, path)`,
        `CREATE TABLE IF NOT EXISTS builder_app_records (
          project_id TEXT NOT NULL,
          collection_name TEXT NOT NULL,
          record_id TEXT NOT NULL,
          data_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (project_id, collection_name, record_id),
          FOREIGN KEY (project_id) REFERENCES builder_projects(project_id) ON DELETE CASCADE
        )`,
        `CREATE INDEX IF NOT EXISTS builder_app_records_collection
          ON builder_app_records (project_id, collection_name, updated_at DESC)`,
      ],
      "write"
    ).then(() => undefined).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return db;
}

async function requireSchema(): Promise<Client> {
  const db = await ensureSchema();
  if (!db) throw new Error(PERSISTENCE_ERROR);
  return db;
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
  return Buffer.from(rowText(value), "base64");
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
  return databaseConfig() !== null;
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

function recordUpsert(record: LocalProjectRecord): InStatement {
  return {
    sql: `INSERT INTO builder_projects (project_id, tenant_id, record_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        record_json = excluded.record_json,
        updated_at = excluded.updated_at
      WHERE builder_projects.tenant_id = excluded.tenant_id`,
    args: [record.projectId, record.tenantId, JSON.stringify(record), record.lastModifiedAt || new Date().toISOString()],
  };
}

function fileReplacementStatements(
  record: LocalProjectRecord,
  kind: "source" | "deployment",
  files: PersistedFile[]
): InStatement[] {
  const updatedAt = new Date().toISOString();
  return [
    {
      sql: "DELETE FROM builder_project_files WHERE project_id = ? AND tenant_id = ? AND kind = ?",
      args: [record.projectId, record.tenantId, kind],
    },
    ...files.map((file) => ({
      sql: `INSERT INTO builder_project_files
        (project_id, tenant_id, kind, path, content, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [record.projectId, record.tenantId, kind, assertSafeRelativePath(file.path), file.content, updatedAt],
    })),
  ];
}

async function persistSnapshot(
  record: LocalProjectRecord,
  kind: "source" | "deployment",
  files: PersistedFile[]
): Promise<void> {
  const db = await ensureSchema();
  if (!db) return;
  const transaction = await db.transaction("write");
  try {
    const owner = await transaction.execute({
      sql: "SELECT tenant_id FROM builder_projects WHERE project_id = ? LIMIT 1",
      args: [record.projectId],
    });
    if (owner.rows[0] && rowText(owner.rows[0].tenant_id) !== record.tenantId) {
      throw new Error("That project id is already owned by another tenant");
    }
    const results = await transaction.batch([
      recordUpsert(record),
      ...fileReplacementStatements(record, kind, files),
    ]);
    if (results[0].rowsAffected === 0) {
      throw new Error("That project id is already owned by another tenant");
    }
    await transaction.commit();
  } catch (error) {
    if (!transaction.closed) await transaction.rollback().catch(() => undefined);
    throw error;
  } finally {
    transaction.close();
  }
}

export const durableProjectStore = {
  async saveRecord(record: LocalProjectRecord): Promise<void> {
    const db = await ensureSchema();
    if (!db) return;
    const result = await db.execute(recordUpsert(record));
    if (result.rowsAffected === 0) {
      throw new Error("That project id is already owned by another tenant");
    }
  },

  async projectIdExists(projectId: string): Promise<boolean> {
    const db = await ensureSchema();
    if (!db) return false;
    const result = await db.execute({
      sql: "SELECT 1 FROM builder_projects WHERE project_id = ? LIMIT 1",
      args: [projectId],
    });
    return result.rows.length > 0;
  },

  async loadRecord(projectId: string, tenantId: string): Promise<LocalProjectRecord | null> {
    const db = await ensureSchema();
    if (!db) return null;
    const result = await db.execute({
      sql: "SELECT record_json FROM builder_projects WHERE project_id = ? AND tenant_id = ? LIMIT 1",
      args: [projectId, tenantId],
    });
    if (!result.rows[0]) return null;
    const parsed = JSON.parse(rowText(result.rows[0].record_json)) as LocalProjectRecord;
    return parsed.tenantId === tenantId ? parsed : null;
  },

  async listRecords(tenantId: string): Promise<LocalProjectRecord[]> {
    const db = await ensureSchema();
    if (!db) return [];
    const result = await db.execute({
      sql: "SELECT record_json FROM builder_projects WHERE tenant_id = ? ORDER BY updated_at DESC",
      args: [tenantId],
    });
    return result.rows
      .map((row) => JSON.parse(rowText(row.record_json)) as LocalProjectRecord)
      .filter((record) => record.tenantId === tenantId);
  },

  async saveSource(record: LocalProjectRecord, workspaceDir: string): Promise<void> {
    const files = collectDirectoryFiles(workspaceDir);
    await persistSnapshot(record, "source", files);
  },

  async saveDeployment(record: LocalProjectRecord, files: PersistedFile[]): Promise<void> {
    if (files.length === 0) throw new Error("The successful build produced no deployment files");
    await persistSnapshot(record, "deployment", files);
  },

  async restoreSource(projectId: string, tenantId: string, workspaceDir: string): Promise<number> {
    const db = await ensureSchema();
    if (!db) return 0;
    const result = await db.execute({
      sql: `SELECT files.path, files.content
        FROM builder_project_files AS files
        INNER JOIN builder_projects AS projects
          ON projects.project_id = files.project_id AND projects.tenant_id = files.tenant_id
        WHERE files.project_id = ? AND files.tenant_id = ? AND files.kind = 'source'
        ORDER BY files.path`,
      args: [projectId, tenantId],
    });
    if (result.rows.length === 0) return 0;

    const resolvedWorkspace = path.resolve(workspaceDir);
    const parent = path.dirname(resolvedWorkspace);
    const name = path.basename(resolvedWorkspace);
    fs.mkdirSync(parent, { recursive: true });
    const staging = fs.mkdtempSync(path.join(parent, `.${name}.restore-`));
    let backup: string | null = null;
    const preserved: string[] = [];

    try {
      for (const row of result.rows) {
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
    return result.rows.length;
  },

  async readDeploymentFile(projectId: string, requestedPath: string): Promise<PersistedFile | null> {
    const db = await ensureSchema();
    if (!db) return null;
    const normalized = assertSafeRelativePath(requestedPath || "index.html");
    const result = await db.execute({
      sql: `SELECT files.path, files.content
        FROM builder_project_files AS files
        INNER JOIN builder_projects AS projects
          ON projects.project_id = files.project_id AND projects.tenant_id = files.tenant_id
        WHERE files.project_id = ? AND files.kind = 'deployment' AND files.path = ? LIMIT 1`,
      args: [projectId, normalized],
    });
    const row = result.rows[0];
    return row ? { path: rowText(row.path), content: rowBytes(row.content) } : null;
  },

  async readPublicSourceFile(projectId: string, requestedPath: string): Promise<PersistedFile | null> {
    const db = await ensureSchema();
    if (!db) return null;
    const normalized = assertSafeRelativePath(requestedPath);
    if (!normalized.startsWith("public/")) return null;
    const result = await db.execute({
      sql: `SELECT files.path, files.content
        FROM builder_project_files AS files
        INNER JOIN builder_projects AS projects
          ON projects.project_id = files.project_id AND projects.tenant_id = files.tenant_id
        WHERE files.project_id = ? AND files.kind = 'source' AND files.path = ? LIMIT 1`,
      args: [projectId, normalized],
    });
    const row = result.rows[0];
    return row ? { path: rowText(row.path), content: rowBytes(row.content) } : null;
  },

  async listAppCollections(projectId: string): Promise<Array<{ name: string; count: number }>> {
    const db = await requireSchema();
    const result = await db.execute({
      sql: `SELECT records.collection_name, COUNT(*) AS record_count
        FROM builder_app_records AS records
        INNER JOIN builder_projects AS projects ON projects.project_id = records.project_id
        WHERE records.project_id = ?
        GROUP BY records.collection_name ORDER BY records.collection_name`,
      args: [projectId],
    });
    return result.rows.map((row) => ({
      name: rowText(row.collection_name),
      count: Number(row.record_count) || 0,
    }));
  },

  async listAppRecords(
    projectId: string,
    collectionName: string,
    options: { limit?: number; offset?: number } = {}
  ): Promise<{ records: AppRecord[]; total: number }> {
    const db = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const limit = Math.min(200, Math.max(1, Math.trunc(options.limit ?? 50)));
    const offset = Math.max(0, Math.trunc(options.offset ?? 0));
    const [rows, count] = await Promise.all([
      db.execute({
        sql: `SELECT record_id, data_json, created_at, updated_at
          FROM builder_app_records
          WHERE project_id = ? AND collection_name = ?
          ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        args: [projectId, collection, limit, offset],
      }),
      db.execute({
        sql: `SELECT COUNT(*) AS record_count FROM builder_app_records
          WHERE project_id = ? AND collection_name = ?`,
        args: [projectId, collection],
      }),
    ]);
    return {
      records: rows.rows.map((row) => appRecordFromRow(row as Record<string, unknown>)),
      total: Number(count.rows[0]?.record_count) || 0,
    };
  },

  /** Owner-facing database queries apply filters/sorts before pagination. */
  async listAllAppRecords(projectId: string, collectionName: string): Promise<AppRecord[]> {
    const db = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const result = await db.execute({
      sql: `SELECT record_id, data_json, created_at, updated_at
        FROM builder_app_records
        WHERE project_id = ? AND collection_name = ?
        ORDER BY updated_at DESC`,
      args: [projectId, collection],
    });
    return result.rows.map((row) => appRecordFromRow(row as Record<string, unknown>));
  },

  async getAppRecord(projectId: string, collectionName: string, recordId: string): Promise<AppRecord | null> {
    const db = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const result = await db.execute({
      sql: `SELECT record_id, data_json, created_at, updated_at
        FROM builder_app_records
        WHERE project_id = ? AND collection_name = ? AND record_id = ? LIMIT 1`,
      args: [projectId, collection, recordId],
    });
    const row = result.rows[0];
    return row ? appRecordFromRow(row as Record<string, unknown>) : null;
  },

  async createAppRecord(
    projectId: string,
    collectionName: string,
    value: Record<string, unknown>
  ): Promise<AppRecord> {
    const db = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const recordId = randomUUID();
    const now = new Date().toISOString();
    const data = appRecordData(value);
    const result = await db.execute({
      sql: `INSERT INTO builder_app_records
        (project_id, collection_name, record_id, data_json, created_at, updated_at)
        SELECT project_id, ?, ?, ?, ?, ? FROM builder_projects WHERE project_id = ?`,
      args: [collection, recordId, JSON.stringify(data), now, now, projectId],
    });
    if (result.rowsAffected !== 1) throw new Error("Project not found");
    return { ...data, _id: recordId, createdAt: now, updatedAt: now };
  },

  async updateAppRecord(
    projectId: string,
    collectionName: string,
    recordId: string,
    patch: Record<string, unknown>
  ): Promise<AppRecord | null> {
    const db = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const transaction = await db.transaction("write");
    try {
      const result = await transaction.execute({
        sql: `SELECT record_id, data_json, created_at, updated_at
          FROM builder_app_records
          WHERE project_id = ? AND collection_name = ? AND record_id = ? LIMIT 1`,
        args: [projectId, collection, recordId],
      });
      const row = result.rows[0];
      if (!row) {
        await transaction.rollback();
        return null;
      }

      const current = appRecordFromRow(row as Record<string, unknown>);
      const data = appRecordData({ ...current, ...patch });
      const updatedAt = new Date().toISOString();
      const update = await transaction.execute({
        sql: `UPDATE builder_app_records SET data_json = ?, updated_at = ?
          WHERE project_id = ? AND collection_name = ? AND record_id = ?`,
        args: [JSON.stringify(data), updatedAt, projectId, collection, recordId],
      });
      if (update.rowsAffected !== 1) {
        await transaction.rollback();
        return null;
      }
      await transaction.commit();
      return { ...data, _id: recordId, createdAt: current.createdAt, updatedAt };
    } catch (error) {
      if (!transaction.closed) await transaction.rollback().catch(() => undefined);
      throw error;
    } finally {
      transaction.close();
    }
  },

  async deleteAppRecord(projectId: string, collectionName: string, recordId: string): Promise<boolean> {
    const db = await requireSchema();
    const collection = assertAppCollectionName(collectionName);
    const result = await db.execute({
      sql: `DELETE FROM builder_app_records
        WHERE project_id = ? AND collection_name = ? AND record_id = ?`,
      args: [projectId, collection, recordId],
    });
    return result.rowsAffected > 0;
  },

  async remove(projectId: string, tenantId: string): Promise<boolean> {
    const db = await ensureSchema();
    if (!db) return false;
    const results = await db.batch(
      [
        {
          sql: "DELETE FROM builder_project_files WHERE project_id = ? AND tenant_id = ?",
          args: [projectId, tenantId],
        },
        {
          sql: `DELETE FROM builder_app_records WHERE project_id = ?
            AND EXISTS (SELECT 1 FROM builder_projects WHERE project_id = ? AND tenant_id = ?)`,
          args: [projectId, projectId, tenantId],
        },
        {
          sql: "DELETE FROM builder_projects WHERE project_id = ? AND tenant_id = ?",
          args: [projectId, tenantId],
        },
      ],
      "write"
    );
    return results[2].rowsAffected > 0;
  },
};
