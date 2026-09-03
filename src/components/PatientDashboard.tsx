"use client";

import { useCallback, useEffect, useState } from "react";
import { supabaseBrowser, supabaseStranger } from "@/lib/supabase";

type Row = { id: string; role: string; content: string; created_at: string };

type Patient = {
  id: string;
  email: string | null;
  consent_at: string | null;
  consent_clinic_name: string | null;
  marketing_consent_at: string | null;
  origin_lead_session_id: string | null;
};

type AccessCheck = { mine: number; stranger: number; strangerError: string | null };

type State =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "denied" }
  | { status: "ready"; patient: Patient; messages: Row[]; access: AccessCheck };

/**
 * The patient's own view — and the access-control demonstration.
 *
 * EVERY read on this page goes through `supabaseBrowser()`, the anon-key client
 * carrying the patient's auth token. It is bound by Row Level Security: the
 * rows below are the rows Postgres decided `auth.uid()` is allowed to see. The
 * admin key never touches this page. That means an empty screen here is a real
 * access-control result, not a rendering bug — which is also the trap, because
 * RLS denials are silent (an empty array, no error).
 *
 * So the page runs the negative case too: the same query on a deliberately
 * signed-OUT client. "1 row as you, 0 rows as a stranger" is the evidence.
 */
export default function PatientDashboard({ patientSessionId }: { patientSessionId: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(async () => {
    const db = supabaseBrowser();
    const { data: sessionData } = await db.auth.getSession();
    if (!sessionData.session) {
      setState({ status: "signed-out" });
      return;
    }

    const { data: patientRow } = await db
      .from("patient_sessions")
      .select(
        "id, email, consent_at, consent_clinic_name, marketing_consent_at, origin_lead_session_id",
      )
      .eq("id", patientSessionId)
      .maybeSingle();

    // Signed in, but the policy returned nothing: this record belongs to
    // someone else. Say so plainly rather than showing an empty shell.
    if (!patientRow) {
      setState({ status: "denied" });
      return;
    }

    const { data: messageRows } = await db
      .from("messages")
      .select("id, role, content, created_at")
      .eq("session_id", patientSessionId)
      .order("created_at", { ascending: true });

    const mine = (messageRows ?? []) as Row[];

    // The negative control, run live from the same browser with the same
    // public key and no session.
    const { data: strangerRows, error: strangerError } = await supabaseStranger()
      .from("messages")
      .select("id")
      .eq("session_id", patientSessionId);

    setState({
      status: "ready",
      patient: patientRow as unknown as Patient,
      messages: mine.filter((row) => row.role === "user" || row.role === "assistant"),
      access: {
        mine: mine.length,
        stranger: (strangerRows ?? []).length,
        strangerError: strangerError?.message ?? null,
      },
    });
  }, [patientSessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return <p className="text-sm text-zinc-500">Checking your access…</p>;
  }

  if (state.status === "signed-out") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-900 dark:text-zinc-100">You are not signed in.</p>
        <p className="mt-1.5 text-xs leading-5 text-zinc-500">
          This page reads through the same public key any visitor has, so without your session
          it can see nothing at all. That is the access control working, not an error.
        </p>
      </div>
    );
  }

  if (state.status === "denied") {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-900 dark:text-zinc-100">
          This record does not belong to your account.
        </p>
        <p className="mt-1.5 text-xs leading-5 text-zinc-500">
          Postgres refused the row — the policy matches on <code>auth.uid()</code>, not on the
          id in the URL.
        </p>
      </div>
    );
  }

  const { patient, messages, access } = state;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Your record</h2>
        <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <Field label="Email" value={patient.email ?? "—"} />
          <Field
            label="Consent given"
            value={
              patient.consent_at
                ? `${new Date(patient.consent_at).toLocaleString()} — ${patient.consent_clinic_name ?? ""}`
                : "not given"
            }
          />
          <Field
            label="Marketing consent"
            value={
              patient.marketing_consent_at
                ? new Date(patient.marketing_consent_at).toLocaleString()
                : "declined — separate from care consent"
            }
          />
          <Field
            label="Came from"
            value={patient.origin_lead_session_id ?? "direct signup"}
            mono
          />
        </dl>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Carried over from before you signed up
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          {messages.length} message{messages.length === 1 ? "" : "s"}, with their original ids
          and timestamps. Nothing was re-asked.
        </p>
        <div className="mt-3 space-y-3">
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
                <span className="mt-1 block text-[10px] opacity-60">
                  {new Date(message.created_at).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Access control, checked live
        </h2>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          Both queries ran just now from this browser, against the same table with the same
          public key. The only difference is whether a session was attached.
        </p>
        <ul className="mt-3 space-y-1.5 text-xs">
          <li className="text-zinc-800 dark:text-zinc-200">
            <strong>Signed in as you:</strong> {access.mine} message
            {access.mine === 1 ? "" : "s"} readable
          </li>
          <li className={access.stranger === 0 ? "text-teal-800 dark:text-teal-300" : "text-red-700"}>
            <strong>Signed out (a stranger with your URL):</strong> {access.stranger} readable
            {access.stranger === 0 ? " ✓" : " — RLS FAILURE"}
            {access.strangerError ? ` (${access.strangerError})` : ""}
          </li>
        </ul>
      </section>

      <button
        onClick={async () => {
          await supabaseBrowser().auth.signOut();
          await load();
        }}
        className="text-xs text-zinc-500 underline hover:text-zinc-800 dark:hover:text-zinc-200"
      >
        Sign out (then reload — this page goes blank, on purpose)
      </button>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className={mono ? "font-mono text-[11px] text-zinc-800 dark:text-zinc-200" : "text-zinc-800 dark:text-zinc-200"}>
        {value}
      </dd>
    </div>
  );
}
