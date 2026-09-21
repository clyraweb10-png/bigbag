import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";

const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf8").split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        process.env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
      }
    }
  });
}

const { localFileManager } = require("../src/lib/local-orchestrator/file-manager") as typeof import("../src/lib/local-orchestrator/file-manager");
const { localProjectStore } = require("../src/lib/local-orchestrator/project-store") as typeof import("../src/lib/local-orchestrator/project-store");
const { durableProjectStore } = require("../src/lib/local-orchestrator/durable-project-store") as typeof import("../src/lib/local-orchestrator/durable-project-store");
const {
  extractFilesFromMarkdown,
  isSourceBuildFailure,
  postProcessGeneratedFiles,
} = require("../src/lib/local-orchestrator/agent-engine") as typeof import("../src/lib/local-orchestrator/agent-engine");
const {
  generationValidationIssues,
} = require("../src/lib/local-orchestrator/generation-validator") as typeof import("../src/lib/local-orchestrator/generation-validator");
const {
  writeStarterTemplate,
} = require("../src/lib/local-orchestrator/starter-template") as typeof import("../src/lib/local-orchestrator/starter-template");

function sha256(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function runBuild(workspaceDir: string): { success: boolean; output: string } {
  const viteBin = path.join(process.cwd(), "node_modules", "vite", "bin", "vite.js");
  const proc = spawnSync(process.execPath, [viteBin, "build"], {
    cwd: workspaceDir,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    env: { ...process.env, NODE_ENV: "production" },
  });
  const output = (proc.stdout || "") + (proc.stderr || "");
  return { success: proc.status === 0, output };
}

test("TEST 1: Simple Multi-File Project Generation & Execution", async () => {
  const projectId = `test-simple-${Date.now()}`;
  const tenantId = "00000000-0000-4000-8000-000000000001";

  localProjectStore.create({
    projectId,
    tenantId,
    label: "Todo App",
    description: "Multi-file simple todo app",
  });

  const workspaceDir = localProjectStore.getWorkspaceDir(projectId);
  writeStarterTemplate(workspaceDir, projectId);

  // Model response generating multiple modular files: App, components, types
  const aiResponse = `
### File: src/types/todo.ts
\`\`\`ts
export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
}
\`\`\`

### File: src/components/TodoItemView.tsx
\`\`\`tsx
import React from "react";
import type { TodoItem } from "../types/todo";

export function TodoItemView({
  item,
  onToggle,
}: {
  item: TodoItem;
  onToggle: (id: string) => void;
}) {
  return (
    <li className="flex items-center gap-2 py-1">
      <input
        type="checkbox"
        checked={item.completed}
        onChange={() => onToggle(item.id)}
        aria-label={item.text}
      />
      <span className={item.completed ? "line-through text-slate-400" : ""}>
        {item.text}
      </span>
    </li>
  );
}
\`\`\`

### File: src/App.tsx
\`\`\`tsx
import React, { useState } from "react";
import type { TodoItem } from "./types/todo";
import { TodoItemView } from "./components/TodoItemView";

export default function App() {
  const [todos, setTodos] = useState<TodoItem[]>([
    { id: "1", text: "Buy groceries", completed: false },
    { id: "2", text: "Build real AI engine", completed: true },
  ]);

  const toggle = (id: string) => {
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, completed: !t.completed } : t))
    );
  };

  return (
    <main className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">Real Multi-File Todo</h1>
      <ul className="divide-y divide-slate-200">
        {todos.map((todo) => (
          <TodoItemView key={todo.id} item={todo} onToggle={toggle} />
        ))}
      </ul>
    </main>
  );
}
\`\`\`
`;

  const extracted = extractFilesFromMarkdown(aiResponse);
  assert.equal(extracted.length, 3, "Expected 3 files to be extracted");
  assert.deepEqual(
    extracted.map((f) => f.path),
    ["src/types/todo.ts", "src/components/TodoItemView.tsx", "src/App.tsx"]
  );

  postProcessGeneratedFiles(extracted);
  const issues = generationValidationIssues(extracted, [
    "package.json",
    "index.html",
    "vite.config.ts",
    "src/main.tsx",
  ]);
  assert.deepEqual(issues, [], "Multi-file todo must pass generation validation");

  // Write files to workspace filesystem
  for (const file of extracted) {
    localFileManager.writeContent(projectId, file.path, file.content, "utf8");
    assert.ok(
      fs.existsSync(path.join(workspaceDir, file.path)),
      `File ${file.path} must exist on disk`
    );
  }

  // Verify tree contains the newly created files
  const tree = localFileManager.getTree(projectId);
  const paths = tree.entries.map((e) => e.path);
  assert.ok(paths.includes("src/types/todo.ts"));
  assert.ok(paths.includes("src/components/TodoItemView.tsx"));
  assert.ok(paths.includes("src/App.tsx"));

  // Run real Vite build
  writeStarterTemplate(workspaceDir, projectId); // ensures main.tsx points to App.tsx
  const buildResult = runBuild(workspaceDir);
  assert.ok(buildResult.success, `Build should succeed: ${buildResult.output}`);

  // Cleanup
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

test("TEST 2: Complex Multi-File Generation (7 Distinct Files)", async () => {
  const projectId = `test-complex-${Date.now()}`;
  const tenantId = "00000000-0000-4000-8000-000000000001";

  localProjectStore.create({
    projectId,
    tenantId,
    label: "Analytics Dashboard",
    description: "Complex dashboard with 7 files",
  });

  const workspaceDir = localProjectStore.getWorkspaceDir(projectId);
  writeStarterTemplate(workspaceDir, projectId);

  const complexResponse = `
### File: src/types/analytics.ts
\`\`\`ts
export interface Metric {
  id: string;
  label: string;
  value: string;
  change: string;
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  role: string;
}
\`\`\`

### File: src/lib/mockData.ts
\`\`\`ts
import type { Metric, UserRow } from "../types/analytics";

export const initialMetrics: Metric[] = [
  { id: "1", label: "Active Users", value: "24,531", change: "+12%" },
  { id: "2", label: "Monthly Revenue", value: "$182,400", change: "+8.4%" },
  { id: "3", label: "Conversion Rate", value: "3.42%", change: "+0.3%" },
];

export const initialUsers: UserRow[] = [
  { id: "u1", name: "Alice Smith", email: "alice@example.com", role: "Admin" },
  { id: "u2", name: "Bob Jones", email: "bob@example.com", role: "Viewer" },
  { id: "u3", name: "Carol White", email: "carol@example.com", role: "Editor" },
];
\`\`\`

### File: src/components/Navbar.tsx
\`\`\`tsx
import React from "react";

export function Navbar({ title }: { title: string }) {
  return (
    <header className="border-b border-slate-200 px-6 py-4 flex items-center justify-between bg-white">
      <h1 className="font-semibold text-lg text-slate-900">{title}</h1>
      <span className="text-xs bg-emerald-100 text-emerald-800 font-medium px-2 py-1 rounded">Live</span>
    </header>
  );
}
\`\`\`

### File: src/components/Sidebar.tsx
\`\`\`tsx
import React from "react";

export function Sidebar({ currentTab, onSelectTab }: { currentTab: string; onSelectTab: (t: string) => void }) {
  const tabs = ["Overview", "Users", "Settings"];
  return (
    <aside className="w-56 border-r border-slate-200 bg-slate-50 p-4">
      <nav className="space-y-1">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => onSelectTab(tab)}
            className={\`w-full text-left px-3 py-2 rounded text-sm font-medium \${
              currentTab === tab ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-200"
            }\`}
          >
            {tab}
          </button>
        ))}
      </nav>
    </aside>
  );
}
\`\`\`

### File: src/components/MetricCard.tsx
\`\`\`tsx
import React from "react";
import type { Metric } from "../types/analytics";

export function MetricCard({ metric }: { metric: Metric }) {
  return (
    <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm">
      <p className="text-xs text-slate-500">{metric.label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{metric.value}</p>
      <span className="text-xs text-emerald-600 font-medium">{metric.change}</span>
    </div>
  );
}
\`\`\`

### File: src/components/DataTable.tsx
\`\`\`tsx
import React from "react";
import type { UserRow } from "../types/analytics";

export function DataTable({ users }: { users: UserRow[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-slate-50 border-b border-slate-200">
        <tr>
          <th className="p-3">Name</th>
          <th className="p-3">Email</th>
          <th className="p-3">Role</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {users.map((u) => (
          <tr key={u.id} className="hover:bg-slate-50">
            <td className="p-3 font-medium text-slate-900">{u.name}</td>
            <td className="p-3 text-slate-600">{u.email}</td>
            <td className="p-3 text-slate-600">{u.role}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
\`\`\`

### File: src/App.tsx
\`\`\`tsx
import React, { useState } from "react";
import { Navbar } from "./components/Navbar";
import { Sidebar } from "./components/Sidebar";
import { MetricCard } from "./components/MetricCard";
import { DataTable } from "./components/DataTable";
import { initialMetrics, initialUsers } from "./lib/mockData";

export default function App() {
  const [tab, setTab] = useState("Overview");

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900">
      <Navbar title="Company Analytics" />
      <div className="flex flex-1">
        <Sidebar currentTab={tab} onSelectTab={setTab} />
        <main className="flex-1 p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {initialMetrics.map((m) => (
              <MetricCard key={m.id} metric={m} />
            ))}
          </div>
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
            <h2 className="text-base font-semibold mb-3">Team Members</h2>
            <DataTable users={initialUsers} />
          </div>
        </main>
      </div>
    </div>
  );
}
\`\`\`
`;

  const files = extractFilesFromMarkdown(complexResponse);
  assert.equal(files.length, 7, "Must extract exactly 7 files");

  for (const f of files) {
    localFileManager.writeContent(projectId, f.path, f.content, "utf8");
    assert.ok(fs.existsSync(path.join(workspaceDir, f.path)), `File ${f.path} exists`);
  }

  writeStarterTemplate(workspaceDir, projectId);
  const buildResult = runBuild(workspaceDir);
  assert.ok(buildResult.success, `7-file dashboard build passed: ${buildResult.output}`);

  // Cleanup
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

test("TEST 3: Incremental Edit Modifies ONLY Target File Without Touching Unrelated Files", async () => {
  const projectId = `test-incremental-${Date.now()}`;
  const tenantId = "00000000-0000-4000-8000-000000000001";

  localProjectStore.create({
    projectId,
    tenantId,
    label: "Modular App",
    description: "Testing targeted incremental edits",
  });

  const workspaceDir = localProjectStore.getWorkspaceDir(projectId);
  writeStarterTemplate(workspaceDir, projectId);

  // Setup initial multi-file project
  localFileManager.writeContent(projectId, "src/components/Navbar.tsx", `
export function Navbar() { return <header>Navbar</header>; }
`, "utf8");

  localFileManager.writeContent(projectId, "src/components/Sidebar.tsx", `
export function Sidebar() { return <aside>Sidebar</aside>; }
`, "utf8");

  localFileManager.writeContent(projectId, "src/components/MetricCard.tsx", `
export function MetricCard({ label }: { label: string }) { return <div>{label}</div>; }
`, "utf8");

  localFileManager.writeContent(projectId, "src/App.tsx", `
import { Navbar } from "./components/Navbar";
import { Sidebar } from "./components/Sidebar";
import { MetricCard } from "./components/MetricCard";

export default function App() {
  return (
    <div>
      <Navbar />
      <Sidebar />
      <MetricCard label="Initial" />
    </div>
  );
}
`, "utf8");

  // Record initial hashes
  const navbarHash = sha256(fs.readFileSync(path.join(workspaceDir, "src/components/Navbar.tsx")));
  const sidebarHash = sha256(fs.readFileSync(path.join(workspaceDir, "src/components/Sidebar.tsx")));
  const appHash = sha256(fs.readFileSync(path.join(workspaceDir, "src/App.tsx")));

  // Simulated incremental follow-up: User asks "Add an icon to the MetricCard"
  // The AI outputs ONLY the modified src/components/MetricCard.tsx
  const followUpEdit = `
### File: src/components/MetricCard.tsx
\`\`\`tsx
export function MetricCard({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 p-2 border rounded">
      <span className="w-2 h-2 rounded-full bg-emerald-500" />
      <span>{label}</span>
    </div>
  );
}
\`\`\`
`;

  const editedFiles = extractFilesFromMarkdown(followUpEdit);
  assert.equal(editedFiles.length, 1, "Only 1 file in the incremental edit response");
  assert.equal(editedFiles[0].path, "src/components/MetricCard.tsx");

  // Validation succeeds because existing files provide the entrypoint
  const treeEntries = localFileManager.getTree(projectId).entries.map((e) => e.path);
  const issues = generationValidationIssues(editedFiles, treeEntries);
  assert.deepEqual(issues, [], "Incremental edit validation passes with existing entrypoint");

  // Write ONLY the edited file
  localFileManager.writeContent(projectId, editedFiles[0].path, editedFiles[0].content, "utf8");

  // Verify UNRELATED files have EXACT identical hashes (bit-for-bit unchanged!)
  const newNavbarHash = sha256(fs.readFileSync(path.join(workspaceDir, "src/components/Navbar.tsx")));
  const newSidebarHash = sha256(fs.readFileSync(path.join(workspaceDir, "src/components/Sidebar.tsx")));
  const newAppHash = sha256(fs.readFileSync(path.join(workspaceDir, "src/App.tsx")));

  assert.equal(navbarHash, newNavbarHash, "Navbar.tsx must be 100% untouched");
  assert.equal(sidebarHash, newSidebarHash, "Sidebar.tsx must be 100% untouched");
  assert.equal(appHash, newAppHash, "App.tsx must be 100% untouched");

  // Verify the target file was updated
  const updatedMetricCard = fs.readFileSync(path.join(workspaceDir, "src/components/MetricCard.tsx"), "utf8");
  assert.ok(updatedMetricCard.includes("bg-emerald-500"), "MetricCard was updated with new code");

  // Cleanup
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

test("TEST 4: Compiler Error Detection & Error Recovery Loop", async () => {
  const projectId = `test-recovery-${Date.now()}`;
  const tenantId = "00000000-0000-4000-8000-000000000001";

  localProjectStore.create({
    projectId,
    tenantId,
    label: "Error App",
    description: "Testing compiler error recovery",
  });

  const workspaceDir = localProjectStore.getWorkspaceDir(projectId);
  writeStarterTemplate(workspaceDir, projectId);

  // Introduce an intentional syntax error into App.tsx
  const brokenCode = `
import React from "react";

export default function App() {
  // Syntax error: unclosed tag and unclosed function
  return (
    <div>
      <h1>Broken App</h1>
`;

  // Remove placeholder page so main mounts App.tsx
  localFileManager.deleteFile(projectId, "src/app/page.tsx");
  localFileManager.writeContent(projectId, "src/App.tsx", brokenCode, "utf8");
  fs.unlinkSync(path.join(workspaceDir, "src/main.tsx"));
  writeStarterTemplate(workspaceDir, projectId);

  // Run build and verify failure is caught
  const initialBuild = runBuild(workspaceDir);
  assert.equal(initialBuild.success, false, "Build must fail on broken code");
  assert.ok(initialBuild.output.length > 0, "Build must produce error diagnostic");

  const buildError = new Error(`Generated app failed to compile:\n${initialBuild.output}`);
  assert.ok(isSourceBuildFailure(buildError), "isSourceBuildFailure must detect compiler failure");

  // The AI produces a repair fix based on the compiler error
  const repairResponse = `
### File: src/App.tsx
\`\`\`tsx
import React from "react";

export default function App() {
  return (
    <div>
      <h1>Repaired App</h1>
    </div>
  );
}
\`\`\`
`;

  const repairedFiles = extractFilesFromMarkdown(repairResponse);
  assert.equal(repairedFiles.length, 1);
  postProcessGeneratedFiles(repairedFiles);

  for (const f of repairedFiles) {
    localFileManager.writeContent(projectId, f.path, f.content, "utf8");
  }

  // Re-run build: now passes!
  const repairedBuild = runBuild(workspaceDir);
  assert.ok(repairedBuild.success, `Repaired build must pass: ${repairedBuild.output}`);

  // Cleanup
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});

test("TEST 5: Full Persistence & Restore Parity from Supabase PostgreSQL", async () => {
  const projectId = `test-persist-${Date.now()}`;
  const tenantId = "00000000-0000-4000-8000-000000000001";
  const now = new Date().toISOString();

  const record = {
    projectId,
    tenantId,
    label: "Multi-File Persistent",
    description: "Testing Supabase PostgreSQL persistence and restore",
    createdAt: now,
    lastModifiedAt: now,
    port: 4105,
    status: "done" as const,
    serverStatus: "Active" as const,
    conversation: [],
  };

  localProjectStore.create(record);
  const workspaceDir = localProjectStore.getWorkspaceDir(projectId);
  writeStarterTemplate(workspaceDir, projectId);

  // Create real multi-file architecture on disk
  localFileManager.writeContent(projectId, "src/components/Header.tsx", `
export function Header() { return <header>Durable Header</header>; }
`, "utf8");
  localFileManager.writeContent(projectId, "src/components/Footer.tsx", `
export function Footer() { return <footer>Durable Footer</footer>; }
`, "utf8");
  localFileManager.writeContent(projectId, "src/lib/constants.ts", `
export const APP_VERSION = "2.0.0";
`, "utf8");
  localFileManager.writeContent(projectId, "src/App.tsx", `
import { Header } from "./components/Header";
import { Footer } from "./components/Footer";
import { APP_VERSION } from "./lib/constants";

export default function App() {
  return (
    <div>
      <Header />
      <p>Version: {APP_VERSION}</p>
      <Footer />
    </div>
  );
}
`, "utf8");

  // Save source files to Supabase PostgreSQL
  await durableProjectStore.saveSource(record, workspaceDir);

  // Hash all files on disk before deletion
  const preRestoreHashes = new Map<string, string>();
  const filesToVerify = [
    "package.json",
    "src/components/Header.tsx",
    "src/components/Footer.tsx",
    "src/lib/constants.ts",
    "src/App.tsx",
  ];

  for (const rel of filesToVerify) {
    const full = path.join(workspaceDir, rel);
    preRestoreHashes.set(rel, sha256(fs.readFileSync(full)));
  }

  // WIPE workspace directory completely from disk
  fs.rmSync(workspaceDir, { recursive: true, force: true });
  assert.equal(fs.existsSync(workspaceDir), false, "Workspace must be deleted");

  // RESTORE from Supabase PostgreSQL
  const restoredCount = await durableProjectStore.restoreSource(projectId, tenantId, workspaceDir);
  assert.ok(restoredCount >= 5, `Expected at least 5 restored files, got ${restoredCount}`);

  // Verify byte-for-byte fidelity of all restored files
  for (const rel of filesToVerify) {
    const full = path.join(workspaceDir, rel);
    assert.ok(fs.existsSync(full), `Restored file ${rel} must exist on disk`);
    const restoredHash = sha256(fs.readFileSync(full));
    assert.equal(
      restoredHash,
      preRestoreHashes.get(rel),
      `Restored file ${rel} must match pre-deletion hash byte-for-byte`
    );
  }

  // Build the restored project to confirm full runtime viability
  const restoredBuild = runBuild(workspaceDir);
  assert.ok(restoredBuild.success, `Restored project must build cleanly: ${restoredBuild.output}`);

  // Cleanup
  fs.rmSync(workspaceDir, { recursive: true, force: true });
});
