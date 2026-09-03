"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string };
export type RiskLevel = "low" | "medium" | "high";
export type Risk = { level: RiskLevel; reason: string };

export type Escalation = {
  escalationId: string;
  triageSummary: string[];
  respondWithin: string;
  clinicName: string;
  createdAt: string;
  alreadySent: boolean;
};

const REDACTION_LABELS: Record<string, string> = {
  name: "your name",
  phone: "your phone number",
  email: "your email address",
  id: "your IC number",
};

/**
 * The patient intake chat.
 *
 * The risk banner below is rendered from the SERVER's decision, never from
 * anything this component infers about the text. `decideRisk()` runs on the
 * server, takes the max of the keyword and model layers, and its verdict is
 * already stored against the message before this component sees it. A banner
 * computed in the browser would be a second, weaker copy of the safety rule —
 * and the one an attacker or a bug could silently switch off.
 *
 * Note the banner is also shown on a 502. When the model is unreachable the
 * server still returns the keyword layer's verdict, so someone who typed
 * "crushing chest pain" is told to dial 999 even though no reply arrived.
 */
export default function PatientChat({
  patientSessionId,
  initialMessages,
  initialRisk = null,
  initialEscalation = null,
  onProfileChanged,
}: {
  patientSessionId: string;
  initialMessages: ChatMessage[];
  /**
   * The risk the SERVER stored against this patient's most recent message,
   * re-read on page load through their own RLS-bound client.
   *
   * WHY THIS PROP EXISTS: risk used to live only in React state, set from a
   * chat response. That meant someone who typed "crushing chest pain" and then
   * reloaded the page lost both the emergency banner and the route to a human
   * — at exactly the moment they needed both. Reloading a page must not be
   * able to clear a safety state; the verdict is durable in the database, so
   * the UI reads it back rather than remembering it.
   */
  initialRisk?: Risk | null;
  /** A handoff already sent for that same message, so a reload does not offer to re-send it. */
  initialEscalation?: Escalation | null;
  onProfileChanged: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [risk, setRisk] = useState<Risk | null>(initialRisk);
  const [redactedNote, setRedactedNote] = useState<string | null>(null);
  const [escalation, setEscalation] = useState<Escalation | null>(initialEscalation);
  const [escalating, setEscalating] = useState(false);
  const [escalateError, setEscalateError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending) return;

    setError(null);
    setRedactedNote(null);
    setEscalateError(null);
    // A new message is a new potential trigger, so the previous confirmation
    // must not stand in for it. If this turn flags too, the clinic should be
    // offered the update — and if the patient sends it, the server keys on the
    // message id, so re-sending an already-sent one is a no-op rather than a
    // second entry in someone's queue.
    setEscalation(null);
    setInput("");
    setSending(true);

    // Optimistic echo of what they typed. The server stores the raw text as the
    // clinical record and a redacted copy for the model; the note underneath
    // says what was stripped on the way out.
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: message },
    ]);

    try {
      // The route holds the admin key and therefore bypasses RLS, so it
      // verifies this token against patient_sessions.auth_user_id server-side.
      // Without it the id in the body would be the only access control.
      const { data } = await supabaseBrowser().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError("Your session has expired. Please sign in again.");
        return;
      }

      const response = await fetch("/api/patient/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ patientSessionId, message }),
      });
      const payload = await response.json();

      // Set risk BEFORE the ok-check: a 502 still carries the keyword verdict.
      if (payload.risk) setRisk(payload.risk as Risk);

      if (!response.ok) {
        setError(payload.error ?? "Something went wrong. Please try again.");
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: payload.id, role: "assistant", content: payload.reply },
      ]);

      const kinds: string[] = payload.redacted ?? [];
      if (kinds.length > 0) {
        const labels = kinds.map((kind) => REDACTION_LABELS[kind] ?? kind);
        setRedactedNote(
          `We removed ${labels.join(" and ")} before sending that to the AI. ` +
            `The clinic still has what you typed.`,
        );
      }

      if (payload.profileChanged) onProfileChanged();
    } catch {
      setError("Could not reach the clinic. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  /**
   * Hand the conversation to a human.
   *
   * Note what this request does NOT contain: a risk level, a message id, or a
   * triage summary. It says only which session it is. The server re-reads the
   * verdict it stored earlier and refuses with 422 if nothing on file is
   * Medium or High — so this button cannot manufacture an escalation, it can
   * only ask for one the server already agrees is warranted.
   *
   * The chat is NOT closed afterwards. The whole promise of the product is
   * that the patient does not have to start again with the human; they carry
   * on in the same thread while the clinic reads what has already been said.
   */
  async function sendToClinic() {
    if (escalating) return;
    setEscalateError(null);
    setEscalating(true);

    try {
      const { data } = await supabaseBrowser().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setEscalateError("Your session has expired. Please sign in again.");
        return;
      }

      const response = await fetch("/api/patient/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ patientSessionId }),
      });
      const payload = await response.json();

      if (!response.ok) {
        setEscalateError(payload.error ?? "Could not send this to the clinic. Please try again.");
        return;
      }
      setEscalation(payload as Escalation);
    } catch {
      setEscalateError(
        "Could not reach the clinic. If this is urgent, do not wait for us — dial 999.",
      );
    } finally {
      setEscalating(false);
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="border-b border-zinc-100 px-5 py-3 dark:border-zinc-900">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Intake</h2>
        <p className="mt-0.5 text-xs text-zinc-500">
          Carries on from your earlier conversation. Nothing is asked twice.
        </p>
      </div>

      <div
        className="flex-1 space-y-4 overflow-y-auto p-5"
        style={{ minHeight: 300, maxHeight: 420 }}
      >
        {messages.map((message) => (
          <div
            key={message.id}
            className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                message.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-sm bg-teal-700 px-4 py-2.5 text-sm leading-6 text-white"
                  : "max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-2.5 text-sm leading-6 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
              }
            >
              {message.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start" aria-live="polite" aria-label="Assistant is typing">
            <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-zinc-100 px-4 py-3 dark:bg-zinc-900">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {risk && risk.level !== "low" && <RiskBanner risk={risk} />}

      {/*
        The handoff. Offered whenever the SERVER has judged something Medium or
        High — and offered rather than done automatically, because sending a
        conversation to another human is a disclosure, and it is the patient's
        to make. The emergency instruction above is not: that renders either way.
      */}
      {risk && risk.level !== "low" && (
        <SendToClinic
          onSend={sendToClinic}
          sending={escalating}
          escalation={escalation}
          error={escalateError}
        />
      )}

      {redactedNote && (
        <p className="border-t border-zinc-100 px-5 py-2.5 text-xs text-teal-800 dark:border-zinc-900 dark:text-teal-300">
          {redactedNote}
        </p>
      )}
      {error && (
        <p className="border-t border-zinc-100 px-5 py-2.5 text-xs text-red-700 dark:border-zinc-900 dark:text-red-400">
          {error}
        </p>
      )}

      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-zinc-100 p-3 dark:border-zinc-900"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Tell the clinic what is going on"
          maxLength={2000}
          disabled={sending}
          className="flex-1 rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-teal-600 disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
        <button
          type="submit"
          disabled={sending || input.trim().length === 0}
          className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send
        </button>
      </form>

      {/*
        CLAUDE.md invariant #8. Every surface that can take a message carries
        this, not only the ones where a risk has already been detected — by the
        time a risk is detected it can already be too late.
      */}
      <p className="border-t border-zinc-100 px-5 py-3 text-xs leading-5 text-zinc-500 dark:border-zinc-900">
        If this is an emergency, exit Nightingale and dial <strong>999</strong>. This is an
        AI assistant, not a doctor, and it does not diagnose.
      </p>
    </div>
  );
}

/**
 * The clinician handoff.
 *
 * TWO DELIBERATE CHOICES IN THIS COMPONENT:
 *
 * 1. After sending, it shows the patient the EXACT bullets that went to the
 *    clinic. A handoff the person cannot see is a disclosure they have to take
 *    on trust, and this whole product is an argument that they should not have
 *    to. It costs nothing to show: every bullet is their own words or their own
 *    profile, so there is nothing here they did not already say.
 *
 * 2. The button stays available afterwards. If they tell us something new and
 *    it flags again, that is a new event and the clinic should get it. The
 *    server is idempotent on the triggering message, so pressing it twice for
 *    the SAME message returns the existing escalation instead of queueing a
 *    duplicate — a duplicate costs someone else their place in the queue.
 */
function SendToClinic({
  onSend,
  sending,
  escalation,
  error,
}: {
  onSend: () => void;
  sending: boolean;
  escalation: Escalation | null;
  error: string | null;
}) {
  return (
    <div className="border-t border-zinc-100 px-5 py-4 dark:border-zinc-900">
      {escalation ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-900/50 dark:bg-teal-950/40">
          <p className="text-sm font-semibold text-teal-900 dark:text-teal-200">
            {escalation.alreadySent
              ? `${escalation.clinicName} already has this.`
              : `Sent to ${escalation.clinicName}.`}{" "}
            A clinician usually responds within {escalation.respondWithin}.
          </p>
          <p className="mt-1 text-xs leading-5 text-teal-800 dark:text-teal-300">
            You do not need to explain any of it again — they can see the whole conversation.
            Keep talking below if there is more; anything new goes to them too.
          </p>

          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-400">
            Exactly what they received
          </p>
          <ul className="mt-1.5 space-y-1">
            {escalation.triageSummary.map((bullet, index) => (
              <li
                key={index}
                className="text-xs leading-5 text-teal-900 dark:text-teal-200"
              >
                • {bullet}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={onSend}
            disabled={sending}
            className="w-full rounded-xl bg-zinc-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {sending ? "Sending…" : "Send this to a clinician"}
          </button>
          <p className="mt-2 text-xs leading-5 text-zinc-500">
            A real person reads it. They get what you have already told us — what is going on,
            anything you take, anything you react to, and where you first got in touch — so you
            never have to start again. You can keep chatting while you wait.
          </p>
        </>
      )}

      {error && (
        <p className="mt-2 text-xs leading-5 text-red-700 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}

/**
 * High says "now", Medium says "soon and we are not certain". Neither ever
 * names a condition — the banner reports a RISK LEVEL, which is a decision
 * about urgency, not a diagnosis (CLAUDE.md invariant #3).
 */
function RiskBanner({ risk }: { risk: Risk }) {
  const high = risk.level === "high";
  return (
    <div
      role="alert"
      className={
        high
          ? "border-t border-red-200 bg-red-50 px-5 py-3.5 dark:border-red-900/50 dark:bg-red-950/40"
          : "border-t border-amber-200 bg-amber-50 px-5 py-3.5 dark:border-amber-900/50 dark:bg-amber-950/40"
      }
    >
      <p
        className={
          high
            ? "text-sm font-semibold text-red-800 dark:text-red-300"
            : "text-sm font-semibold text-amber-900 dark:text-amber-300"
        }
      >
        {high
          ? "Stop and call 999 now, or go to your nearest emergency department."
          : "This is worth having a clinician look at soon."}
      </p>
      <p
        className={
          high
            ? "mt-1 text-xs leading-5 text-red-700 dark:text-red-400"
            : "mt-1 text-xs leading-5 text-amber-800 dark:text-amber-400"
        }
      >
        {risk.reason}
      </p>
    </div>
  );
}
