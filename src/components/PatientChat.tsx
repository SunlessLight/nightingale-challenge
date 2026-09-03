"use client";

import { useEffect, useRef, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string };
export type RiskLevel = "low" | "medium" | "high";
export type Risk = { level: RiskLevel; reason: string };

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
  onProfileChanged,
}: {
  patientSessionId: string;
  initialMessages: ChatMessage[];
  onProfileChanged: () => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [risk, setRisk] = useState<Risk | null>(null);
  const [redactedNote, setRedactedNote] = useState<string | null>(null);
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
