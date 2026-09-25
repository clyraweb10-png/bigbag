/** The sole model used by generation, planning, chat, and visual analysis. */
export const GLM_53_MODEL = "glm-5.3-flash-modal";
export const GLM_53_PROVIDER_ID = "above-glm53";

export function glm53Config(): { apiKey: string; baseUrl: string; model: string } | null {
  const apiKey = process.env.ABOVE_API_KEY?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (process.env.ABOVE_BASE_URL || "https://api.above.dev/v1").trim().replace(/\/$/, ""),
    model: process.env.ABOVE_MODEL?.trim() || GLM_53_MODEL,
  };
}
