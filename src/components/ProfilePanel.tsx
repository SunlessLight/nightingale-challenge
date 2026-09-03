"use client";

import { useCallback, useEffect, useState } from "react";
import { CATEGORY_LABELS } from "@/lib/profile";
import { supabaseBrowser } from "@/lib/supabase";

type Item = {
  id: string;
  category: keyof typeof CATEGORY_LABELS;
  value: string;
  status: "active" | "stopped" | "resolved" | "unconfirmed";
  provenance_pointer: string;
  updated_at: string;
};

/**
 * The live Patient Profile.
 *
 * TWO THINGS THIS COMPONENT IS DELIBERATELY DOING:
 *
 * 1. It reads through `supabaseBrowser()` — the anon key carrying the patient's
 *    own session — so the rows shown are the rows the `profile_items_own_read`
 *    policy decided `auth.uid()` may see. The admin key never touches this
 *    page. An empty panel is a real access-control result, not a render bug.
 *
 * 2. It shows the SENTENCE behind every fact. `provenance_pointer` is a foreign
 *    key to `messages.id`, so each item can be traced to the exact utterance it
 *    came from — including one said while the person was still an anonymous
 *    guest, because conversion re-points messages rather than copying them and
 *    every id survives. A profile you cannot audit is a rumour.
 *
 * Stopped and resolved items stay on the list. A medication history with the
 * stopped drugs filtered out is a worse record, not a tidier one.
 */
export default function ProfilePanel({
  patientSessionId,
  refreshKey,
}: {
  patientSessionId: string;
  refreshKey: number;
}) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [provenance, setProvenance] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const db = supabaseBrowser();

    const { data: rows } = await db
      .from("profile_items")
      .select("id, category, value, status, provenance_pointer, updated_at")
      .eq("patient_session_id", patientSessionId)
      .order("updated_at", { ascending: false });

    const list = (rows ?? []) as unknown as Item[];
    setItems(list);

    // Resolve the provenance pointers in one round trip. Two queries rather
    // than a PostgREST embed, because an embed's shape depends on the foreign
    // key's generated CONSTRAINT NAME — a detail no application code should be
    // coupled to. Both queries are RLS-bound either way.
    const ids = [...new Set(list.map((item) => item.provenance_pointer))];
    if (ids.length === 0) {
      setProvenance({});
      return;
    }

    const { data: sources } = await db
      .from("messages")
      .select("id, content, created_at")
      .in("id", ids);

    const map: Record<string, string> = {};
    for (const row of (sources ?? []) as { id: string; content: string }[]) {
      map[row.id] = row.content;
    }
    setProvenance(map);
  }, [patientSessionId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (items === null) {
    return (
      <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-500">Loading your profile…</p>
      </section>
    );
  }

  const categories = (Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).filter(
    (category) => items.some((item) => item.category === category),
  );

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Your profile</h2>
      <p className="mt-1 text-xs leading-5 text-zinc-500">
        Built from what you have already said. Every entry shows the sentence it came from.
        Corrections change an entry&rsquo;s status — nothing is ever deleted.
      </p>

      {items.length === 0 ? (
        <p className="mt-4 text-xs text-zinc-500">
          Nothing recorded yet. Anything you tell the intake chat below will appear here.
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {categories.map((category) => (
            <div key={category}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {CATEGORY_LABELS[category]}
              </h3>
              <ul className="mt-2 space-y-2">
                {items
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <li
                      key={item.id}
                      className="rounded-xl border border-zinc-200 bg-zinc-50 px-3.5 py-2.5 dark:border-zinc-800 dark:bg-zinc-900/50"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className="text-sm leading-6 text-zinc-800 dark:text-zinc-100">
                          {item.value}
                        </span>
                        <StatusChip status={item.status} />
                      </div>
                      <p className="mt-1.5 text-[11px] leading-5 text-zinc-500">
                        <span className="font-medium">Because you said:</span>{" "}
                        {provenance[item.provenance_pointer] ? (
                          <q className="italic">{provenance[item.provenance_pointer]}</q>
                        ) : (
                          <span className="italic">
                            source message not readable by this account
                          </span>
                        )}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * "Stopped" is the status that proves the correction rule works: the patient
 * said they stopped a medication, and the row is still here, marked, rather
 * than gone. That is the difference between a medical record and a cache.
 */
function StatusChip({ status }: { status: Item["status"] }) {
  const styles: Record<Item["status"], string> = {
    active: "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-300",
    stopped: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300",
    resolved: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    unconfirmed: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${styles[status]}`}
    >
      {status}
    </span>
  );
}
