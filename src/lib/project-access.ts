import "server-only";

import fs from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const OWNERS_FILE = path.join(DATA_DIR, "project-owners.json");

function readOwners(): Record<string, string> {
  try {
    return fs.existsSync(OWNERS_FILE) ? JSON.parse(fs.readFileSync(OWNERS_FILE, "utf8")) : {};
  } catch { return {}; }
}

function writeOwners(owners: Record<string, string>): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${OWNERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(owners, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, OWNERS_FILE);
}

export const projectAccess = {
  canAccess: (userId: string, projectId: string) => readOwners()[projectId] === userId,
  assign(userId: string, projectId: string): void {
    const owners = readOwners();
    if (owners[projectId] && owners[projectId] !== userId) {
      throw new Error("Project ownership conflict");
    }
    owners[projectId] = userId;
    writeOwners(owners);
  },
  remove(userId: string, projectId: string): void { const owners = readOwners(); if (owners[projectId] !== userId) return; delete owners[projectId]; writeOwners(owners); },
  filter<T extends { projectId: string }>(userId: string, projects: T[]): T[] { const owners = readOwners(); return projects.filter((project) => owners[project.projectId] === userId); },
  claimLegacyProjects(userId: string, projectIds: string[]): void {
    // Opt-in migration only: otherwise the first arbitrary Google account to
    // sign in to an upgraded deployment could claim every pre-auth project.
    if (
      process.env.FIREBASE_CLAIM_LEGACY_PROJECTS !== "true" ||
      !process.env.FIREBASE_ALLOWED_EMAILS?.trim()
    ) return;
    const owners = readOwners();
    if (Object.keys(owners).length > 0 || projectIds.length === 0) return;
    for (const id of projectIds) owners[id] = userId;
    writeOwners(owners);
  },
};
