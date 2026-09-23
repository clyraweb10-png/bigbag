import { NextRequest, NextResponse } from "next/server";
import { callPlanner, streamChatResponse } from "@/lib/local-orchestrator/planner-client";
import { plannerPromptForIntent } from "@/lib/local-orchestrator/planner-prompts";
import { ONBOARDING_PROMPT } from "@/lib/local-orchestrator/planner-prompts";
import { normalizePlannerText, parsePlannerOutput } from "@/lib/local-orchestrator/planner-output";
import type { UserIntent } from "@/lib/local-orchestrator/intent-router";
import { AUTH_COOKIE, verifyAuthSession } from "@/lib/auth-session";
import { DESIGN_SYSTEM_PROMPT } from "@/lib/design-system-prompt";
import {
  EMPTY_PROJECT_CONTEXT,
  parseOnboardingOutput,
  questionAlreadyAnswered,
  type OnboardingAnalysis,
  type ProjectContext,
} from "@/lib/local-orchestrator/onboarding-context";

const ONBOARDING_DESIGN_CONTEXT =
  DESIGN_SYSTEM_PROMPT.match(/## 2\. Semantic design tokens[\s\S]*?(?=## 6\. Page composition)/)?.[0] ||
  DESIGN_SYSTEM_PROMPT;

export interface PlannerRequestBody {
  intent: UserIntent | "onboard";
  message: string;
  /** Trimmed conversation history — up to last 10 messages for context. */
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  context?: ProjectContext;
  stream?: boolean;
}

export interface PlannerResponseData {
  text: string;
  durationMs: number;
  provider: string;
  intent: UserIntent | "onboard";
  suggestions: string[];
  onboarding?: OnboardingAnalysis;
}

export async function POST(req: NextRequest): Promise<Response> {
  if (!verifyAuthSession(req.cookies.get(AUTH_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "Sign in with Google to continue" }, { status: 401 });
  }
  let body: PlannerRequestBody;
  try {
    body = (await req.json()) as PlannerRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { intent, message, history = [], context = EMPTY_PROJECT_CONTEXT } = body;

  if (!message?.trim()) {
    return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });
  }

  const plannerIntent = intent === "chat" || intent === "plan" || intent === "update_plan"
    ? intent
    : null;
  if (intent === "onboard") {
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [{
      role: "user",
      content: [
        "Conversation:",
        ...history.slice(-10).map((entry) => `${entry.role}: ${entry.content}`),
        `user: ${message}`,
        `Current structured context: ${JSON.stringify(context)}`,
        "Existing BigBag design-system source of truth:",
        ONBOARDING_DESIGN_CONTEXT,
      ].join("\n\n"),
    }];
    try {
      let result = await callPlanner(ONBOARDING_PROMPT, messages, { onlyGlm53: true });
      let durationMs = result.durationMs;
      let analysis = parseOnboardingOutput(result.text, context, { allowAnsweredQuestion: true });
      if (
        analysis.nextQuestion &&
        questionAlreadyAnswered(analysis.context, analysis.nextQuestion.kind)
      ) {
        const answeredKind = analysis.nextQuestion.kind;
        messages.push(
          { role: "assistant", content: result.text },
          {
            role: "user",
            content: `${answeredKind} is already answered in the structured context. Return corrected JSON that preserves every known fact and either asks one genuinely missing question or returns nextQuestion as null.`,
          }
        );
        result = await callPlanner(ONBOARDING_PROMPT, messages, { onlyGlm53: true });
        durationMs += result.durationMs;
        analysis = parseOnboardingOutput(result.text, analysis.context);
      }
      return NextResponse.json({
        ok: true,
        data: {
          text: "",
          durationMs,
          provider: "ai",
          intent,
          suggestions: [],
          onboarding: analysis,
        } satisfies PlannerResponseData,
      });
    } catch (err) {
      console.error("[/api/planner] Onboarding error:", err);
      return NextResponse.json({ ok: false, error: "I couldn't inspect the project context. Please try again." });
    }
  }
  if (!plannerIntent) {
    return NextResponse.json(
      { ok: false, error: "intent must be onboard, chat, plan, or update_plan" },
      { status: 400 }
    );
  }
  const systemPrompt = plannerPromptForIntent(plannerIntent)!;

  // Build message list from history + current user message.
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...history.slice(-10), // last 10 messages for context
    { role: "user", content: message },
  ];

  if (plannerIntent === "chat" && body.stream) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          if (!req.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        };
        try {
          for await (const event of streamChatResponse(systemPrompt, messages, message, req.signal)) {
            send(event);
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : "Chat request failed";
          send({ type: "error", category: "provider_error", message: reason });
        } finally {
          if (!req.signal.aborted) controller.close();
        }
      },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  }

  try {
    const result = await callPlanner(systemPrompt, messages, { onlyGlm53: true });
    const plannerOutput = parsePlannerOutput(result.text);
    const response: { ok: true; data: PlannerResponseData } = {
      ok: true,
      data: {
        text: normalizePlannerText(plannerIntent, plannerOutput.text),
        durationMs: result.durationMs,
        provider: "ai",
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
