import Link from "next/link";
import { notFound } from "next/navigation";
import ConsentSignup from "@/components/ConsentSignup";
import GuestChat, { type ChatMessage } from "@/components/GuestChat";
import { CLINIC_ID, CLINIC_NAME } from "@/lib/clinic";
import { countValueEventPeople, valueEventCopy } from "@/lib/funnel";
import { loadLeadMessages, loadLeadSession } from "@/lib/leadSessions";

/**
 * The anonymous guest surface. No auth, no sign-up, no cookie — the session
 * id is in the URL, which also means this link restores the conversation.
 *
 * force-dynamic because the value_event count is a live database count. A
 * cached page would show a stale number, and a social-proof number that is
 * quietly wrong is worse than no number at all.
 */
export const dynamic = "force-dynamic";

const CHANNEL_LABELS: Record<string, string> = {
  staff_referral: "Referred by clinic staff",
  social_comment: "From a comment on our post",
  instagram_ad_click: "From our Instagram ad",
  google_ad_click: "From our Google ad",
  website_widget: "From our website",
};

export default async function GuestPage({ params }: PageProps<"/guest/[leadSessionId]">) {
  const { leadSessionId } = await params;

  const lead = await loadLeadSession(leadSessionId);
  if (!lead) notFound();

  const [history, valueEventCount] = await Promise.all([
    loadLeadMessages(lead.id),
    countValueEventPeople(CLINIC_ID),
  ]);

  const messages: ChatMessage[] = history
    .filter((row) => row.role === "user" || row.role === "assistant")
    .map((row) => ({
      id: row.id,
      role: row.role as "user" | "assistant",
      content: row.content,
    }));

  // Null when the count is 0 — renders nothing at all, not "0 people".
  const socialProof = valueEventCopy(valueEventCount);

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
      <div className="mb-5 flex items-baseline justify-between gap-4">
        <div>
          <Link href="/" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {CLINIC_NAME}
          </Link>
          <p className="mt-0.5 text-xs text-zinc-500">
            {CHANNEL_LABELS[lead.source_channel] ?? lead.source_channel}
            {lead.campaign_id ? ` · ${lead.campaign_id.replace(/[_-]+/g, " ")}` : ""}
          </p>
        </div>
        {socialProof && (
          <p className="shrink-0 rounded-full bg-teal-50 px-3 py-1 text-xs text-teal-800 dark:bg-teal-950 dark:text-teal-300">
            {socialProof}
          </p>
        )}
      </div>

      <GuestChat leadSessionId={lead.id} initialMessages={messages} />

      {/*
        The ask comes AFTER the conversation, never in front of it. It is also
        hidden once this lead has already converted, so a shared link cannot be
        used to claim someone else's record a second time.
      */}
      {!lead.converted_patient_id && (
        <ConsentSignup
          leadSessionId={lead.id}
          clinicName={CLINIC_NAME}
          messageCount={messages.length}
        />
      )}

      {/*
        The brief's central complaint is that sign-up feels invasive. Saying
        out loud what we have NOT asked for is cheap, and it is the whole
        reason someone keeps typing.
      */}
      <p className="mt-4 text-xs leading-5 text-zinc-500">
        You are anonymous. {CLINIC_NAME} has not asked for your name, email or phone number,
        and nothing here reaches a clinician until you choose to send it.
      </p>
    </main>
  );
}
