import type {
  VcaasProject,
  VcaasProjectSummary,
  AgentStatus,
  ConversationMessage,
  FileTree,
  FileTreeEntry,
  FileContent,
  FileWriteResult,
} from "@/lib/vcaas-types";

export interface LocalProjectRecord {
  projectId: string;
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
  sandboxId?: string;
  conversation: ConversationMessage[];
}
