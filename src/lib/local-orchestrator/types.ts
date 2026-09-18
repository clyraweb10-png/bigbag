import type { ConversationMessage } from "@/lib/vcaas-types";

export interface LocalProjectRecord {
  projectId: string;
  /** Opaque server-issued tenant id. Never accepted from a request body. */
  tenantId: string;
  label?: string;
  description: string;
  createdAt: string;
  lastModifiedAt?: string;
  agentStartedAt?: string;
  port: number;
  status: "init" | "done" | "idle";
  serverStatus: "Active" | "Starting" | "Stopped" | "Error";
  rebuildStatus?: "idle" | "rebuilding" | "success" | "error";
  rebuildStartedAt?: string;
  rebuildOperationId?: string;
  previewUrl?: string;
  productionProjectUrl?: string;
  sandboxId?: string;
  deployment?: {
    status: "deploying" | "success" | "error";
    createdAt: string;
    versionId?: string;
    errorMessage?: string;
  };
  conversation: ConversationMessage[];
}
