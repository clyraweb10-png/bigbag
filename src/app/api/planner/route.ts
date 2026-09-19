import { NextRequest, NextResponse } from "next/server";
import { callPlanner } from "@/lib/local-orchestrator/planner-client";
import { CHAT_PROMPT, PLANNER_PROMPT, REFINE_PROMPT } from "@/lib/local-orchestrator/planner-prompts";
import type { UserIntent } from "@/lib/local-orchestrator/intent-router";

export interface PlannerRequestBody {
  intent: UserIntent;
  message: string;
  /** Trimmed conversation history — up to last 10 messages for context. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
}

export interface PlannerResponseData {
  text: string;
  durationMs: number;
  provider: string;
  intent: UserIntent;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: PlannerRequestBody;
  try {
    body = (await req.json()) as PlannerRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { intent, message, history = [] } = body;

  if (!message?.trim()) {
    return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });
  }

  // Pick system prompt based on intent.
  let systemPrompt: string;
  if (intent === "plan") {
    systemPrompt = PLANNER_PROMPT;
  } else if (intent === "update_plan") {
    systemPrompt = REFINE_PROMPT;
  } else {
    // "chat" and anything unexpected fall back to chat mode.
    systemPrompt = CHAT_PROMPT;
  }

  // Build message list from history + current user message.
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.slice(-10), // last 10 messages for context
    { role: "user", content: message },
  ];

  try {
    const result = await callPlanner(systemPrompt, messages);
    const response: { ok: true; data: PlannerResponseData } = {
      ok: true,
      data: {
        text: result.text,
        durationMs: result.durationMs,
        provider: result.provider,
        intent,
      },
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("[/api/planner] Error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message || "Planner failed",
      },
      { status: 503 }
    );
  }
}
