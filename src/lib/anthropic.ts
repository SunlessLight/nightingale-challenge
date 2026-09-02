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

/** Re-exported so call sites never need to import the brand from two places. */
export type { Redacted, Turn };
