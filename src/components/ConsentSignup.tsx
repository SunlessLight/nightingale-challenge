"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";

/**
 * The ask. It appears UNDER a conversation that has already been useful,
 * which is the whole psychological argument of this product: consent is
 * requested once trust exists, not as a gate in front of the front door.
 *
 * The copy states what carries over, because "you won't have to repeat
 * yourself" is only trustworthy if we say it before they commit, not after.
 */
export default function ConsentSignup({
  leadSessionId,
  clinicName,
  messageCount,
}: {
  leadSessionId: string;
  clinicName: string;
  messageCount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false);
  const [marketingConsent, setMarketingConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/patient/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadSessionId, email, password, consent, marketingConsent }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Sign-up failed. Please try again.");
        return;
      }

      // The server created and confirmed the account; this signs THIS TAB in,
      // so the patient's own token exists in the browser and every later read
      // goes through RLS as them rather than through our server's admin key.
      const { error: signInError } = await supabaseBrowser().auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (signInError) {
        setError(`Account created, but sign-in failed: ${signInError.message}`);
        return;
      }

      router.push(`/patient/${data.patientSessionId}`);
    } catch {
      setError("Could not reach the clinic. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-5 rounded-2xl border border-teal-200 bg-teal-50/60 p-5 dark:border-teal-900 dark:bg-teal-950/40">
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Want a clinician at {clinicName} to see this?
        </p>
        <p className="mt-1.5 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          {messageCount > 0
            ? `Your ${messageCount} message${messageCount === 1 ? "" : "s"} so far come with you. `
            : ""}
          You will not be asked to repeat anything you have already said.
        </p>
        <button
          onClick={() => setOpen(true)}
          className="mt-3 rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-800"
        >
          Continue with {clinicName}
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-5 space-y-3.5 rounded-2xl border border-teal-200 bg-teal-50/60 p-5 dark:border-teal-900 dark:bg-teal-950/40"
    >
      <div>
        <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Continue with {clinicName}
        </p>
        <p className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">
          Everything you have already told us carries over, with its original timestamps.
        </p>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-teal-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </label>

      <label className="block">
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
          Password (8 characters or more)
        </span>
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="mt-1 w-full rounded-xl border border-zinc-200 bg-white px-3.5 py-2.5 text-sm text-zinc-900 outline-none focus:border-teal-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        />
      </label>

      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700"
        />
        <span className="text-xs leading-5 text-zinc-700 dark:text-zinc-300">
          I consent to {clinicName} storing this conversation and to a clinician there reading
          it so they can help me. I understand this is not an emergency service.
        </span>
      </label>

      {/*
        Separate box, unticked, and never required. Care consent is not
        marketing consent — bundling them is the dark pattern this build is
        arguing against, and the schema keeps two timestamps for exactly this.
      */}
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={marketingConsent}
          onChange={(event) => setMarketingConsent(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-teal-700"
        />
        <span className="text-xs leading-5 text-zinc-500">
          Optional, and separate: {clinicName} may send me health tips and offers. You can
          say no here and still get care.
        </span>
      </label>

      {error && <p className="text-xs leading-5 text-red-700 dark:text-red-400">{error}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy || !consent}
          className="rounded-xl bg-teal-700 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Creating your record…" : "Create my record"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-xl px-3 py-2.5 text-sm text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Not yet
        </button>
      </div>
    </form>
  );
}
