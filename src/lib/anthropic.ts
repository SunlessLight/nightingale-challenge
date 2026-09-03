import Anthropic from "@anthropic-ai/sdk";
import { CHAT_MODEL } from "@/lib/models";
import type { Redacted, Turn } from "@/lib/redaction";

/**
 * The single outbound path to the model.
 *
 * THE POINT OF THIS FILE: `askClaude` accepts only `Redacted` turns. A raw
 * `messages.content` string is a plain `string` and will not type-check here,
 * so CLAUDE.md invariant #5 is enforced by the compiler rather than by a
 * reviewer remembering to check. See src/lib/redaction.ts for the honest
 * limitation and the runtime test that backs it.
 */

export function anthropicClient(): Anthropic {
  // An identity-linked API key returns 400 "anthropic-workspace-id is
  // required" unless every request names its workspace. A plain key ignores
  // the header. Sending it whenever it is set makes both kinds work, and this
  // repo has already lost time to exactly this difference between the laptop
  // key and the Vercel key.
  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic(
    workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {},
  );
}

export type ClaudeReply = {
  text: string;
  inputTokens: number;
  outputTokens: number;
};

export async function askClaude(opts: {
  /**
   * Our own instructions, authored in this repo — not patient text — so a
   * plain string is correct here. Everything that originated with a human
   * goes through `turns`, which is branded.
   */
  system: string;
  turns: Turn[];
  maxTokens?: number;
}): Promise<ClaudeReply> {
  const response = await anthropicClient().messages.create({
    model: CHAT_MODEL,
    // A ceiling, not a reservation: unused headroom costs nothing, and a
    // truncated mid-sentence reply from a clinic assistant reads as broken.
    max_tokens: opts.maxTokens ?? 8000,
    // Opus 5 has adaptive thinking ON by default and REJECTS budget_tokens
    // with a 400. `effort` is the supported dial; "low" keeps guest-chat
    // latency down, and Phase 4 can raise it for risk assessment.
    output_config: { effort: "low" },
    system: opts.system,
    messages: opts.turns.map((turn) => ({
      role: turn.role,
      content: turn.content as string,
    })),
  });

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();

  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// ---------------------------------------------------------------------------
// Structured intake call — one request that returns the reply, the model's own
// risk assessment, and any new profile facts.
//
// WHY ONE CALL AND NOT THREE: a second round trip would add ~5s to every turn
// and double the bill (measured in Phase 2 at ~$0.0085/message). A forced tool
// makes the model emit all three in a single response, so risk assessment and
// memory extraction are effectively free on top of the reply we were already
// paying for.
//
// The tool is FORCED (`tool_choice: {type: "tool"}`) rather than offered,
// because "the model might answer in prose instead" is not an acceptable
// failure mode for the layer that decides whether someone is having a heart
// attack. If it fails anyway, the caller falls back to the keyword layer,
// which is exactly what that layer is for.
// ---------------------------------------------------------------------------

export const PROFILE_CATEGORIES = [
  "chief_complaint",
  "symptom",
  "medication",
  "allergy",
] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

export const PROFILE_STATUSES = ["active", "stopped", "resolved", "unconfirmed"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];

export type ExtractedFact = {
  category: ProfileCategory;
  value: string;
  status: ProfileStatus;
};

export type IntakeResult = {
  reply: string;
  /** The model's OPINION on risk. decideRisk() decides whether it counts. */
  risk: { level: "low" | "medium" | "high"; reason: string; confidence: number } | null;
  facts: ExtractedFact[];
  inputTokens: number;
  outputTokens: number;
};

const INTAKE_TOOL = {
  name: "record_intake",
  description:
    "Record your reply to the patient, your clinical risk assessment of their latest " +
    "message, and any new or changed facts about them. You must call this exactly once.",
  input_schema: {
    type: "object" as const,
    properties: {
      reply: {
        type: "string",
        description:
          "What to say back to the patient. Warm, plain, 2-4 sentences, non-diagnostic.",
      },
      risk_level: {
        type: "string",
        enum: ["low", "medium", "high"],
        description:
          "high = a possible emergency needing care now. medium = should be seen by a " +
          "clinician soon, or you are genuinely unsure. low = routine. When torn between " +
          "two levels, choose the HIGHER one.",
      },
      risk_reason: {
        type: "string",
        description: "One sentence, for a clinician, on why you chose that level.",
      },
      confidence: {
        type: "number",
        description: "0 to 1. Your confidence in the risk level. Be honest about doubt.",
      },
      facts: {
        type: "array",
        description:
          "New or CHANGED facts from the patient's latest message only. Empty if none. " +
          "If they say they stopped a medication, emit that medication with status " +
          "'stopped' — never silently drop it.",
        items: {
          type: "object",
          properties: {
            category: { type: "string", enum: [...PROFILE_CATEGORIES] },
            value: {
              type: "string",
              description:
                "Short and specific, e.g. 'Ibuprofen 400mg twice daily' or " +
                "'Lower back ache, 3 weeks, worse in the morning'.",
            },
            status: { type: "string", enum: [...PROFILE_STATUSES] },
          },
          required: ["category", "value", "status"],
        },
      },
    },
    required: ["reply", "risk_level", "risk_reason", "confidence", "facts"],
  },
};

/** Narrow unknown JSON from the model into our types, dropping anything odd. */
function coerceFacts(raw: unknown): ExtractedFact[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedFact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const fact = item as Record<string, unknown>;
    const category = fact.category;
    const status = fact.status;
    const value = fact.value;
    if (typeof value !== "string" || value.trim() === "") continue;
    if (!PROFILE_CATEGORIES.includes(category as ProfileCategory)) continue;
    out.push({
      category: category as ProfileCategory,
      value: value.trim().slice(0, 300),
      // An unrecognised status becomes 'unconfirmed' rather than being dropped:
      // losing the fact is worse than recording it as needing confirmation.
      status: PROFILE_STATUSES.includes(status as ProfileStatus)
        ? (status as ProfileStatus)
        : "unconfirmed",
    });
  }
  return out;
}

export async function askClaudeIntake(opts: {
  system: string;
  turns: Turn[];
  maxTokens?: number;
}): Promise<IntakeResult> {
  const response = await anthropicClient().messages.create({
    model: CHAT_MODEL,
    max_tokens: opts.maxTokens ?? 8000,
    // Higher than the guest chat's "low": this call is also making the risk
    // judgement, and CLAUDE.md invariant #4 (ambiguous symptoms) is the
    // highest-graded behaviour in the build.
    output_config: { effort: "medium" },
    system: opts.system,
    messages: opts.turns.map((turn) => ({
      role: turn.role,
      content: turn.content as string,
    })),
    tools: [INTAKE_TOOL],
    tool_choice: { type: "tool", name: "record_intake" },
  });

  const block = response.content.find((b) => b.type === "tool_use");
  const usage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };

  if (!block || block.type !== "tool_use") {
    // Prose instead of a tool call. Salvage the text so the patient still gets
    // an answer, and report risk as null so the keyword layer stands alone.
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
    return { reply: text, risk: null, facts: [], ...usage };
  }

  const input = block.input as Record<string, unknown>;
  const level = input.risk_level;
  const validLevel = level === "low" || level === "medium" || level === "high";
  const rawConfidence = typeof input.confidence === "number" ? input.confidence : 0.5;

  return {
    reply: typeof input.reply === "string" ? input.reply.trim() : "",
    risk: validLevel
      ? {
          level,
          reason:
            typeof input.risk_reason === "string" && input.risk_reason.trim()
              ? input.risk_reason.trim()
              : "Assessed by the model.",
          confidence: Math.min(1, Math.max(0, rawConfidence)),
        }
      : null,
    facts: coerceFacts(input.facts),
    ...usage,
  };
}

/** Re-exported so call sites never need to import the brand from two places. */
export type { Redacted, Turn };
