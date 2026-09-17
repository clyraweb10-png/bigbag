import path from "node:path";

function configuredDirectory(name: "BIGBAG_DATA_DIR" | "BIGBAG_WORKSPACES_DIR", fallback: string): string {
  const configured = process.env[name]?.trim();
  return configured ? path.resolve(configured) : fallback;
}

const DEFAULT_DATA_DIR = path.join(process.cwd(), "data");
const DEFAULT_WORKSPACES_DIR = path.join(process.cwd(), "workspaces");

/** Persistent metadata: project records and the separate ownership index. */
export const BIGBAG_DATA_DIR = configuredDirectory("BIGBAG_DATA_DIR", DEFAULT_DATA_DIR);

/** Generated, editable source trees for locally orchestrated projects. */
export const BIGBAG_WORKSPACES_DIR = configuredDirectory("BIGBAG_WORKSPACES_DIR", DEFAULT_WORKSPACES_DIR);
