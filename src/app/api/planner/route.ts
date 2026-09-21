import { NextRequest, NextResponse } from "next/server";
import { callPlanner } from "@/lib/local-orchestrator/planner-client";
import { plannerPromptForIntent } from "@/lib/local-orchestrator/planner-prompts";
import { normalizePlannerText, parsePlannerOutput } from "@/lib/local-orchestrator/planner-output";
import type { UserIntent } from "@/lib/local-orchestrator/intent-router";
import { AUTH_COOKIE, verifyAuthSession } from "@/lib/auth-session";

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
  suggestions: string[];
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!verifyAuthSession(req.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "Sign in with Google to continue" }, { status: 401 });
  }
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

  const plannerIntent = intent === "chat" || intent === "plan" || intent === "update_plan"
    ? intent
    : null;
  if (!plannerIntent) {
    return NextResponse.json(
      { ok: false, error: "intent must be chat, plan, or update_plan" },
      { status: 400 }
    );
  }
  const systemPrompt = plannerPromptForIntent(plannerIntent)!;

  // Build message list from history + current user message.
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.slice(-10), // last 10 messages for context
    { role: "user", content: message },
  ];

  try {
    const result = await callPlanner(systemPrompt, messages);
    const plannerOutput = parsePlannerOutput(result.text);
    const response: { ok: true; data: PlannerResponseData } = {
      ok: true,
      data: {
        text: normalizePlannerText(plannerIntent, plannerOutput.text),
        durationMs: result.durationMs,
        provider: result.provider,
        intent,
        suggestions: plannerOutput.suggestions,
      },
    };
    return NextResponse.json(response);
  } catch (err) {
    console.error("[/api/planner] Error:", err);
    // Provider availability is an expected application-level outcome. Keep the
    // stable JSON envelope and avoid a browser-level 503 while the build route's
    // own model fallback remains available.
    return NextResponse.json(
      {
        ok: false,
        error: "Planning is temporarily unavailable. You can still send the build request directly.",
      }
    );
  }
}
