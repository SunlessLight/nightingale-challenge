import { NextResponse } from "next/server";
import { CLINIC_ID } from "@/lib/clinic";
import { parseChannel, resolveOpening, timeOfDay } from "@/lib/channels";
import { logFunnelEvent } from "@/lib/funnel";
import { createLeadSession, insertLeadMessage } from "@/lib/leadSessions";

/**
 * The four entry points, as one route.
 *
 *   /start?source=instagram_ad_click&campaign=ivf_over40&creative=v2
 *   /start?source=staff_referral&topic=fertility
 *   /start?source=social_comment
 *   /start?source=website_widget          (the floating bubble on /)
 *
 * Ad clicks are just query parameters, which is what they really are in the
 * wild — the ad platform appends them and the landing page reads them.
 *
 * The new session id goes in the REDIRECT PATH, not a cookie. A route handler
 * can write cookies but a React Server Component cannot, so a cookie would
 * force an extra hop for no benefit — and a URL-addressable session gives
 * basic session recovery for free.
 */
export const dynamic = "force-dynamic";

/**
 * Campaign/creative/topic arrive from an untrusted URL and the topic is spoken
 * back in the assistant's own voice, so it is replayed to the model on every
 * later turn. That makes it a PROMPT INJECTION vector, not just an XSS one —
 * React escapes markup, but nothing escapes an LLM prompt. Strip it to plain
 * words and cap the length at the boundary, once.
 */
function cleanParam(raw: string | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^a-zA-Z0-9 _-]/g, "").trim().slice(0, 60);
  return cleaned.length > 0 ? cleaned : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawSource = url.searchParams.get("source");

  // Absent source = someone typed /start directly, treat as the site widget.
  // A source that is present but unrecognised is a mistake worth surfacing,
  // not silently rewriting into a channel that did not happen.
  const channel = rawSource ? parseChannel(rawSource) : "website_widget";
  if (!channel) {
    return NextResponse.json(
      { error: `Unknown source "${rawSource}".` },
      { status: 400 },
    );
  }

  const campaignId = cleanParam(url.searchParams.get("campaign"));
  const creative = cleanParam(url.searchParams.get("creative"));
  const topic = cleanParam(url.searchParams.get("topic"));

  const lead = await createLeadSession({
    channel,
    campaignId,
    creative,
    staffReferralTopic: topic,
    pageContext: {
      // PHI-free arrival context only.
      entry_path: url.pathname,
      referer: request.headers.get("referer")?.slice(0, 200) ?? "direct",
    },
  });

  const opening = resolveOpening({
    channel,
    identityLevel: lead.identity_level,
    timeOfDay: timeOfDay(),
    topic,
    campaign: campaignId,
  });

  // Persisted as a real assistant message so a page reload restores the
  // conversation and the model sees how it opened. It is our own copy, so
  // content and redacted_content are identical here.
  await insertLeadMessage({
    leadSessionId: lead.id,
    role: "assistant",
    content: opening,
    redactedContent: opening,
  });

  await logFunnelEvent({
    sessionId: lead.id,
    sessionType: "lead",
    eventType: "lead_created",
    metadata: {
      clinic_id: CLINIC_ID,
      source_channel: channel,
      time_of_day: timeOfDay(),
      ...(campaignId ? { campaign_id: campaignId } : {}),
    },
  });

  return NextResponse.redirect(new URL(`/guest/${lead.id}`, url.origin), 302);
}
