import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("a qualification ID collision preserves the existing project without creating a suffix", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-qualification-id-"));
  const repo = process.cwd();
  const modulePath = path.join(repo, "src/lib/local-orchestrator/project-store.ts");
  try {
    const child = spawnSync(process.execPath, [
      "-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register", "-e", `
        process.chdir(process.argv[1]);
        const assert = require('node:assert/strict');
        const { localProjectStore } = require(${JSON.stringify(modulePath)});
        localProjectStore.create({ projectId: 'reserved', tenantId: 'owner-a', description: 'Existing project' });
        assert.throws(() => localProjectStore.create({ projectId: 'reserved', tenantId: 'owner-b', description: 'Qualification', qualificationRunId: 'run-a' }), /already in use/);
      `, workspace,
    ], { cwd: repo, encoding: "utf8", timeout: 10_000, env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME,
      TS_NODE_PROJECT: path.join(repo, "tsconfig.json") } });
    assert.equal(child.status, 0, child.stderr || child.error?.message || `worker exited ${child.status}`);
    const projects = JSON.parse(fs.readFileSync(path.join(workspace, "data/projects.json"), "utf8"));
    assert.deepEqual(Object.keys(projects), ["reserved"]);
    assert.equal(projects.reserved.tenantId, "owner-a");
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("concurrent builder processes preserve every project and never expose partial JSON", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-project-index-"));
  const repo = process.cwd();
  const modulePath = path.join(repo, "src/lib/local-orchestrator/project-store.ts");
  const childSource = `
    process.chdir(process.argv[1]);
    const { localProjectStore } = require(${JSON.stringify(modulePath)});
    const worker = process.argv[2];
    for (let index = 0; index < 12; index++) {
      localProjectStore.create({ projectId: "worker-" + worker + "-" + index,
        tenantId: "synthetic", description: "Concurrent index qualification" });
    }
  `;
  let partialRead: Error | null = null;
  const reader = setInterval(() => {
    const index = path.join(workspace, "data/projects.json");
    if (!fs.existsSync(index) || partialRead) return;
    try { JSON.parse(fs.readFileSync(index, "utf8")); }
    catch (error) { partialRead = error as Error; }
  }, 1);
  try {
    await Promise.all(Array.from({ length: 4 }, (_, worker) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [
        "-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register",
        "-e", childSource, workspace, String(worker),
      ], { cwd: repo, env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME,
        TS_NODE_PROJECT: path.join(repo, "tsconfig.json") } });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `worker exited ${code}`)));
    })));
    assert.equal(partialRead, null, partialRead?.message);
    const projects = JSON.parse(fs.readFileSync(path.join(workspace, "data/projects.json"), "utf8"));
    assert.equal(Object.keys(projects).length, 48);
  } finally {
    clearInterval(reader);
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("an abandoned project lock is recovered before the busy timeout", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-project-stale-lock-"));
  const repo = process.cwd();
  const lock = path.join(workspace, "data/projects.json.lock");
  try {
    fs.mkdirSync(lock, { recursive: true });
    const stale = new Date(Date.now() - 11_000);
    fs.utimesSync(lock, stale, stale);
    const modulePath = path.join(repo, "src/lib/local-orchestrator/project-store.ts");
    const child = spawnSync(process.execPath, [
      "-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register",
      "-e", `process.chdir(process.argv[1]); require(${JSON.stringify(modulePath)}).localProjectStore.create({ projectId: "recovered", tenantId: "synthetic", description: "Stale lock recovery" });`,
      workspace,
    ], {
      cwd: repo,
      timeout: 6_000,
      encoding: "utf8",
      env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME,
        TS_NODE_PROJECT: path.join(repo, "tsconfig.json") },
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message || `worker exited ${child.status}`);
    const projects = JSON.parse(fs.readFileSync(path.join(workspace, "data/projects.json"), "utf8"));
    assert.ok(projects.recovered);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("concurrent recovery of one abandoned lock preserves every writer", async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-project-stale-race-"));
  const repo = process.cwd();
  const lock = path.join(workspace, "data/projects.json.lock");
  try {
    fs.mkdirSync(lock, { recursive: true });
    const stale = new Date(Date.now() - 11_000);
    fs.utimesSync(lock, stale, stale);
    const modulePath = path.join(repo, "src/lib/local-orchestrator/project-store.ts");
    await Promise.all(Array.from({ length: 4 }, (_, worker) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [
        "-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register",
        "-e", `process.chdir(process.argv[1]); require(${JSON.stringify(modulePath)}).localProjectStore.create({ projectId: "recovered-" + process.argv[2], tenantId: "synthetic", description: "Stale lock race" });`,
        workspace, String(worker),
      ], { cwd: repo, env: { NODE_ENV: "test", PATH: process.env.PATH, HOME: process.env.HOME,
        TS_NODE_PROJECT: path.join(repo, "tsconfig.json") } });
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(stderr || `worker exited ${code}`)));
    })));
    const projects = JSON.parse(fs.readFileSync(path.join(workspace, "data/projects.json"), "utf8"));
    assert.equal(Object.keys(projects).length, 4);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("an abandoned recovery guard does not block stale project-lock recovery", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-project-recovery-guard-"));
  const repo = process.cwd();
  try {
    const data = path.join(workspace, "data");
    fs.mkdirSync(path.join(data, "projects.json.lock"), { recursive: true });
    fs.mkdirSync(path.join(data, "projects.json.recovery.lock"));
    const stale = new Date(Date.now() - 11_000);
    for (const name of ["projects.json.lock", "projects.json.recovery.lock"]) {
      fs.utimesSync(path.join(data, name), stale, stale);
    }
    const modulePath = path.join(repo, "src/lib/local-orchestrator/project-store.ts");
    const child = spawnSync(process.execPath, [
      "-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register",
      "-e", `process.chdir(process.argv[1]); require(${JSON.stringify(modulePath)}).localProjectStore.create({ projectId: "recovered", tenantId: "synthetic", description: "Recovery guard test" });`,
      workspace,
    ], { cwd: repo, timeout: 6_000, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH,
      HOME: process.env.HOME, TS_NODE_PROJECT: path.join(repo, "tsconfig.json") } });
    assert.equal(child.status, 0, child.stderr || child.error?.message || `worker exited ${child.status}`);
    const projects = JSON.parse(fs.readFileSync(path.join(data, "projects.json"), "utf8"));
    assert.ok(projects.recovered);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test("a fresh lock with an inactive current-process owner is recoverable", () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "bigbag-project-recycled-pid-"));
  const repo = process.cwd();
  try {
    const modulePath = path.join(repo, "src/lib/local-orchestrator/project-store.ts");
    const child = spawnSync(process.execPath, [
      "-r", "ts-node/register/transpile-only", "-r", "tsconfig-paths/register",
      "-e", `
        process.chdir(process.argv[1]);
        const fs = require("node:fs"), path = require("node:path");
        const lock = path.join(process.cwd(), "data/projects.json.lock");
        fs.mkdirSync(lock, { recursive: true });
        fs.writeFileSync(path.join(lock, "owner.json"), JSON.stringify({ token: "old-owner", pid: process.pid }));
        require(${JSON.stringify(modulePath)}).localProjectStore.create({ projectId: "recovered", tenantId: "synthetic", description: "Recycled PID test" });
      `,
      workspace,
    ], { cwd: repo, timeout: 6_000, encoding: "utf8", env: { NODE_ENV: "test", PATH: process.env.PATH,
      HOME: process.env.HOME, TS_NODE_PROJECT: path.join(repo, "tsconfig.json") } });
    assert.equal(child.status, 0, child.stderr || child.error?.message || `worker exited ${child.status}`);
    const projects = JSON.parse(fs.readFileSync(path.join(workspace, "data/projects.json"), "utf8"));
    assert.ok(projects.recovered);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
