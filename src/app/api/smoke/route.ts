import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { auditEnv } from "@/lib/env";
import { supabasePublic } from "@/lib/supabase";

/**
 * Phase 1 wiring proof: env contract, Supabase reachability, Anthropic key.
 *
 * The Anthropic call is behind `?run=llm` on purpose. A bare GET on a public
 * Vercel URL must not be able to spend money — the default response reports
 * configuration only. Delete or auth-gate this route before submission.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const env = auditEnv(process.env);

  // Reachability, not data: RLS is on, so an anonymous SELECT is expected to
  // return an empty array. `error === null` is the signal we want; rows are not.
  let supabase: { reachable: boolean; detail: string };
  try {
    const { error } = await supabasePublic().from("lead_sessions").select("id").limit(1);
    supabase = error
      ? { reachable: false, detail: error.message }
      : { reachable: true, detail: "connected; RLS returned no rows, as expected" };
  } catch (cause) {
    supabase = { reachable: false, detail: (cause as Error).message };
  }

  const runLlm = new URL(request.url).searchParams.get("run") === "llm";
  let anthropic: { called: boolean; ok?: boolean; model?: string; reply?: string; detail?: string } = {
    called: false,
    detail: "add ?run=llm to spend one small call and prove the key",
  };

  if (runLlm) {
    try {
      // Identity-linked API keys must name the workspace the request acts in,
      // or the API returns 400 "anthropic-workspace-id is required". Plain keys
      // ignore the header, so sending it when present is safe either way.
      const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
      const client = new Anthropic(
        workspaceId ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } } : {},
      );
      const response = await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 1024,
        output_config: { effort: "low" },
        system: "Reply with exactly five words and nothing else.",
        messages: [{ role: "user", content: "Confirm this API key works." }],
      });
      const text = response.content.find((block) => block.type === "text");
      anthropic = {
        called: true,
        ok: true,
        model: response.model,
        reply: text?.type === "text" ? text.text : "(no text block)",
      };
    } catch (cause) {
      anthropic = {
        called: true,
        ok: false,
        detail: cause instanceof Anthropic.APIError
          ? `${cause.status}: ${cause.message}`
          : (cause as Error).message,
      };
    }
  }

  // Names and booleans only — never echo a value back over HTTP.
  return NextResponse.json({
    env: { ok: env.ok, missing: env.missing, leaked: env.leaked },
    supabase,
    anthropic,
  });
}
