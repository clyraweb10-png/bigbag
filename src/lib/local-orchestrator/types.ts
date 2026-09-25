import type { ConversationMessage } from "@/lib/vcaas-types";

export interface LocalProjectRecord {
  projectId: string;
  /** Opaque server-issued tenant id. Never accepted from a request body. */
  tenantId: string;
  label?: string;
  description: string;
  qualificationRunId?: string;
  /** True when generated-app data must be authorized by a real end-user session. */
  requiresEndUserAuth?: boolean;
  /** Enables server-enforced shared catalogue reads and owner-only product writes. */
  commerceEnabled?: boolean;
  /** Enables private object storage and the server-owned documents metadata boundary. */
  privateFilesEnabled?: boolean;
  /** Explicit first-generation public catalogs; all other collections remain private. */
  sharedCatalogCollections?: Array<"events" | "courses" | "services" | "tables" | "listings">;
  createdAt: string;
  lastModifiedAt?: string;
  agentStartedAt?: string;
  conversationId?: string;
  activeGenerationId?: string;
  cancellationRequestedAt?: string;
  projectContext?: {
    originalPrompt: string;
    projectName: string | null;
    projectType: string | null;
    onboardingAnswers: Record<string, unknown>;
    referenceUrl: string | null;
  };
  port: number;
  status: "init" | "done" | "idle";
  serverStatus: "Active" | "Starting" | "Stopped" | "Error";
  rebuildStatus?: "idle" | "rebuilding" | "success" | "error";
  rebuildStartedAt?: string;
  rebuildOperationId?: string;
  previewUrl?: string;
  /** Firecrawl screenshot URL, persisted after a successful capture. */
  screenshotUrl?: string;
  productionProjectUrl?: string;
  sandboxId?: string;
  deployment?: {
    status: "deploying" | "success" | "error";
    createdAt: string;
    versionId?: string;
    errorMessage?: string;
  };
  importInProgress?: {
    startedAt: string;
    errorMessage?: string;
  } | null;
  conversation: ConversationMessage[];
}
