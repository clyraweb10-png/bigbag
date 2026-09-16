import fs from "fs";
import path from "path";
import { localProjectStore } from "./project-store";
import { e2bSandboxManager } from "./e2b-sandbox-manager";
import type { FileTree, FileTreeEntry, FileContent, FileWriteResult } from "@/lib/vcaas-types";

const IGNORED_DIRS = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "build"]);

export const localFileManager = {
  getTree(projectId: string): FileTree {
    const rootDir = localProjectStore.getWorkspaceDir(projectId);
    const entries: FileTreeEntry[] = [];
    let filesCount = 0;

    function walk(currentDir: string, depth: number) {
      if (!fs.existsSync(currentDir)) return;
      const items = fs.readdirSync(currentDir, { withFileTypes: true });

      // Sort: folders first, then alphabetical
      items.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const item of items) {
        if (IGNORED_DIRS.has(item.name)) continue;

        const fullPath = path.join(currentDir, item.name);
        const relPath = path.relative(rootDir, fullPath).replace(/\\/g, "/");

        if (item.isDirectory()) {
          entries.push({
            name: item.name,
            path: relPath,
            type: "folder",
            depth,
          });
          walk(fullPath, depth + 1);
        } else {
          filesCount++;
          const stat = fs.statSync(fullPath);
          entries.push({
            name: item.name,
            path: relPath,
            type: "file",
            size: stat.size,
            depth,
          });
        }
      }
    }

    walk(rootDir, 0);

    return {
      entries,
      totalEntries: entries.length,
      offset: 0,
      limit: entries.length,
      hasMore: false,
      commitSha: null,
      filesCount,
    };
  },

  getContent(projectId: string, relativePath: string): FileContent | null {
    const rootDir = localProjectStore.getWorkspaceDir(projectId);
    const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, "");
    const fullPath = path.join(rootDir, safePath);

    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      return null;
    }

    const buffer = fs.readFileSync(fullPath);
    // Check for null bytes to determine if binary
    let isBinary = false;
    const checkLen = Math.min(buffer.length, 8000);
    for (let i = 0; i < checkLen; i++) {
      if (buffer[i] === 0) {
        isBinary = true;
        break;
      }
    }

    return {
      path: relativePath,
      name: path.basename(relativePath),
      size: buffer.length,
      encoding: isBinary ? "base64" : "utf8",
      content: isBinary ? buffer.toString("base64") : buffer.toString("utf-8"),
      commitSha: null,
    };
  },

  writeContent(
    projectId: string,
    relativePath: string,
    content: string,
    encoding: "utf8" | "base64" = "utf8"
  ): FileWriteResult {
    const rootDir = localProjectStore.getWorkspaceDir(projectId);
    const safePath = path.normalize(relativePath).replace(/^(\.\.[\/\\])+/, "");
    const fullPath = path.join(rootDir, safePath);
    const parentDir = path.dirname(fullPath);

    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }

    const exists = fs.existsSync(fullPath);
    const data = encoding === "base64" ? Buffer.from(content, "base64") : Buffer.from(content, "utf-8");

    fs.writeFileSync(fullPath, data);

    // Sync to active E2B sandbox if active
    if (encoding === "utf8") {
      e2bSandboxManager.syncFile(projectId, relativePath, content).catch(() => {});
    }

    return {
      path: relativePath,
      bytesWritten: data.length,
      created: !exists,
      rebuildRequired: true,
    };
  },
};
