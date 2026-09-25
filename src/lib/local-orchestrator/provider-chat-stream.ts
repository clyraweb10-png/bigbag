/** Read an OpenAI-compatible SSE response without treating a partial reply as complete. */
export async function* providerChatDeltas(response: Response): AsyncGenerator<string> {
  if (!response.ok || !response.body) {
    throw new Error(`Chat provider HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let sawDone = false;
  let finishReason = "";

  const parseLine = (line: string): { delta: string; done: boolean; finishReason: string } => {
    if (!line.startsWith("data:")) return { delta: "", done: false, finishReason: "" };
    const data = line.slice(5).trim();
    if (!data) return { delta: "", done: false, finishReason: "" };
    if (data === "[DONE]") return { delta: "", done: true, finishReason: "" };

    let payload: { choices?: Array<{ delta?: { content?: unknown }; finish_reason?: unknown }> };
    try {
      payload = JSON.parse(data);
    } catch {
      throw new Error("Chat provider returned an invalid stream event");
    }
    const choice = payload.choices?.[0];
    const content = choice?.delta?.content;
    const delta = typeof content === "string" ? content : Array.isArray(content)
      ? content.map((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string" ? part.text : "").join("")
      : "";
    return {
      delta,
      done: false,
      finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason.toLowerCase() : "",
    };
  };

  try {
    while (!sawDone) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || "";
      if (done && pending) lines.push(pending);
      for (const line of lines) {
        const event = parseLine(line);
        if (event.finishReason) finishReason = event.finishReason;
        if (event.delta) yield event.delta;
        if (event.done) { sawDone = true; break; }
      }
      if (done) break;
    }
  } finally {
    if (sawDone) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }

  if (!sawDone) throw new Error("Chat provider stream ended before completion");
  if (finishReason === "length") throw new Error("Chat provider reached its output limit before completing the reply");
  if (finishReason !== "stop") throw new Error(`Chat provider did not complete the reply (${finishReason || "missing finish reason"})`);
}
