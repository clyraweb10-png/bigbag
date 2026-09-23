export interface PlannerStreamResult {
  text: string;
  model: string;
  firstTokenMs: number;
  durationMs: number;
}

export async function readPlannerStream(
  response: Response,
  onText: (text: string) => void
): Promise<PlannerStreamResult> {
  if (!response.ok || !response.body) throw new Error(`Chat request failed (HTTP ${response.status})`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let text = "";
  let model = "";
  let firstTokenMs = -1;
  let durationMs = -1;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop() || "";
      if (done && pending.trim()) lines.push(pending);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as {
          type: "start" | "delta" | "done" | "error";
          text?: string;
          model?: string;
          firstTokenMs?: number;
          durationMs?: number;
          message?: string;
        };
        if (event.type === "error") throw new Error(event.message || "Chat provider failed");
        if (event.type === "start") model = event.model || "";
        if (event.type === "delta" && event.text) {
          text += event.text;
          onText(text);
        }
        if (event.type === "done") {
          model = event.model || model;
          firstTokenMs = event.firstTokenMs ?? -1;
          durationMs = event.durationMs ?? -1;
          complete = true;
        }
      }
      if (done) break;
    }
  } finally {
    reader.releaseLock();
  }
  if (!complete || !text.trim()) throw new Error("Chat stream ended before completion");
  return { text, model, firstTokenMs, durationMs };
}
