import assert from "node:assert/strict";
import test from "node:test";
import { providerChatDeltas } from "../src/lib/local-orchestrator/provider-chat-stream";

function streamedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { headers: { "content-type": "text/event-stream" } });
}

async function collect(response: Response): Promise<string> {
  let text = "";
  for await (const delta of providerChatDeltas(response)) text += delta;
  return text;
}

test("chat accepts a fragmented stream only after stop and DONE", async () => {
  const response = streamedResponse([
    'data: {"choices":[{"delta":{"content":"Hel',
    'lo"}}]}\n\ndata: {"choices":[{"delta":{"content":" world"}}]}\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
  ]);
  assert.equal(await collect(response), "Hello world");
});

test("chat rejects a dropped provider connection even after receiving text", async () => {
  const response = streamedResponse([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
  ]);
  await assert.rejects(() => collect(response), /ended before completion/);
});

test("chat rejects output-limit truncation and missing terminal reason", async () => {
  await assert.rejects(() => collect(streamedResponse([
    'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n',
    'data: [DONE]\n\n',
  ])), /output limit/);
  await assert.rejects(() => collect(streamedResponse([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    'data: [DONE]\n\n',
  ])), /missing finish reason/);
});

test("chat rejects malformed provider events", async () => {
  await assert.rejects(() => collect(streamedResponse(['data: {broken}\n\n'])), /invalid stream event/);
});
