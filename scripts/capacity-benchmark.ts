import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Pool } from "pg";
import { normalizeQualificationRunId } from "../src/lib/qualification-run";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const connectionString = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!connectionString) throw new Error("SUPABASE_DATABASE_URL or DATABASE_URL is required");
const requestedQualificationRunId = process.env.BIGBAG_QUALIFICATION_RUN_ID;
const qualificationRunId = requestedQualificationRunId === undefined
  ? undefined
  : normalizeQualificationRunId(requestedQualificationRunId);
if (requestedQualificationRunId !== undefined && !qualificationRunId) throw new Error("Invalid BIGBAG_QUALIFICATION_RUN_ID");

const stages = [1_000, 10_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const samples = 120;

function percentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
}

function summary(values: number[]) {
  return {
    p50Ms: Number(percentile(values, 0.50).toFixed(3)),
    p95Ms: Number(percentile(values, 0.95).toFixed(3)),
    p99Ms: Number(percentile(values, 0.99).toFixed(3)),
    errorRate: 0,
  };
}

async function main() {
  const pool = new Pool({ connectionString, max: 1 });
  const client = await pool.connect();
  const results = [];
  try {
    // Transaction-pooling endpoints can move independent statements between
    // server sessions. Pin the temporary table and all stages to one session.
    await client.query("BEGIN");
    await client.query(`CREATE TEMP TABLE bigbag_capacity_users (
      id BIGINT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      profile JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    let previous = 0;
    for (const target of stages) {
      const insertStarted = performance.now();
      await client.query(
        `INSERT INTO bigbag_capacity_users (id, email, profile)
         SELECT value, 'synthetic-' || value || '@example.invalid', jsonb_build_object('plan', CASE WHEN value % 10 = 0 THEN 'pro' ELSE 'free' END)
         FROM generate_series($1::bigint, $2::bigint) AS value`,
        [previous + 1, target]
      );
      const insertMs = performance.now() - insertStarted;
      const readLatencies: number[] = [];
      const writeLatencies: number[] = [];
      for (let index = 0; index < samples; index += 1) {
        const id = 1 + ((index * 7919) % target);
        const started = performance.now();
        const result = await client.query("SELECT id, email, profile FROM bigbag_capacity_users WHERE id = $1", [id]);
        if (result.rowCount !== 1) throw new Error(`Synthetic read missed id ${id}`);
        readLatencies.push(performance.now() - started);
      }
      for (let index = 0; index < 40; index += 1) {
        const id = 1 + ((index * 3571) % target);
        const started = performance.now();
        const result = await client.query(
          "UPDATE bigbag_capacity_users SET updated_at = NOW() WHERE id = $1 RETURNING id",
          [id]
        );
        if (result.rowCount !== 1) throw new Error(`Synthetic update missed id ${id}`);
        writeLatencies.push(performance.now() - started);
      }
      const size = await client.query("SELECT pg_total_relation_size('bigbag_capacity_users')::bigint AS bytes");
      results.push({
        logicalUsers: target,
        insertedRows: target - previous,
        insertMs: Number(insertMs.toFixed(3)),
        insertThroughputRowsPerSecond: Number(((target - previous) / (insertMs / 1000)).toFixed(1)),
        indexedRead: summary(readLatencies),
        indexedUpdate: summary(writeLatencies),
        tableAndIndexBytes: Number(size.rows[0]?.bytes || 0),
      });
      process.stdout.write(`CAPACITY_STAGE users=${target} insertMs=${insertMs.toFixed(1)} readP95=${summary(readLatencies).p95Ms}\n`);
      previous = target;
    }
    await client.query("DROP TABLE bigbag_capacity_users");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  const outputRoot = process.env.WORKSPACE_ROOT || process.cwd();
  const outputDir = path.join(outputRoot, "output", "bigbag-qualification", ...(qualificationRunId ? [qualificationRunId, "capacity"] : ["capacity"]));
  fs.mkdirSync(outputDir, { recursive: true });
  const report = {
    measuredAt: new Date().toISOString(),
    scope: "Temporary synthetic PostgreSQL data-model benchmark only",
    syntheticData: true,
    measuredCapacity: results.at(-1)?.logicalUsers || 0,
    results,
    processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
    unqualified: [
      "HTTP API concurrency", "authentication throughput", "project opening", "chat traffic",
      "AI generation queue", "connector traffic", "preview concurrency", "provider rate limits",
      "database connection saturation", "database CPU and cache hit rate",
    ],
    conclusion: "This benchmark does not establish one-million-concurrent-user production readiness.",
  };
  fs.writeFileSync(path.join(outputDir, "database-1m.json"), `${JSON.stringify(report, null, 2)}\n`);
  if (qualificationRunId) {
    const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
    await durableProjectStore.saveQualificationBenchmark(qualificationRunId, "database-1m", report);
  }
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
