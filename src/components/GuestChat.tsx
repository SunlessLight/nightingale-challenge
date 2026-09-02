"use client";

import { useEffect, useRef, useState } from "react";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string };

const REDACTION_LABELS: Record<string, string> = {
  name: "your name",
  phone: "your phone number",
  email: "your email address",
  id: "your IC number",
};

export default function GuestChat({
  leadSessionId,
  initialMessages,
}: {
  leadSessionId: string;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

    // Optimistic echo. The server stores the raw text as the clinical record
    // and a redacted copy for the model, so what is shown back is what they
    // typed — the redaction note below explains what was stripped on the way out.
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: "user", content: message },
    ]);

    try {
      const response = await fetch("/api/guest/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadSessionId, message }),
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: data.id, role: "assistant", content: data.reply },
      ]);

      const kinds: string[] = data.redacted ?? [];
      if (kinds.length > 0) {
        const labels = kinds.map((k) => REDACTION_LABELS[k] ?? k);
        setRedactedNote(
          `We removed ${labels.join(" and ")} before sending that to the AI. ` +
            `The clinic still has what you typed.`,
        );
      }
    } catch {
      setError("Could not reach the clinic. Please check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex-1 space-y-4 overflow-y-auto p-5" style={{ minHeight: 340, maxHeight: 460 }}>
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

      <form onSubmit={send} className="flex items-center gap-2 border-t border-zinc-100 p-3 dark:border-zinc-900">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask anything — no sign-up needed"
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
        CLAUDE.md invariant #8. This renders under the chat box on every
        surface that can take a message, not only after a risk is detected —
        by the time a risk is detected it can already be too late.
      */}
      <p className="border-t border-zinc-100 px-5 py-3 text-xs leading-5 text-zinc-500 dark:border-zinc-900">
        If this is an emergency, exit Nightingale and dial <strong>999</strong>. This is an
        AI assistant, not a doctor, and it does not diagnose.
      </p>
    </div>
  );
}
