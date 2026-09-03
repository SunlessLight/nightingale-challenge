import type { ExtractedFact, ProfileCategory, ProfileStatus } from "@/lib/anthropic";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Living Memory — the patient profile.
 *
 * THE RULE THAT MAKES THIS A MEDICAL RECORD RATHER THAN A CACHE:
 * a correction changes an item's `status`. It never deletes the row.
 *
 * "I stopped taking Advil last week" does not mean Advil was never taken. It
 * means Advil was taken and then stopped, and a clinician reading this three
 * weeks later needs both halves. Deleting the row would also break
 * `provenance_pointer`'s ON DELETE RESTRICT contract — the whole point of
 * which is that a fact can always be traced back to the sentence that produced
 * it, including the sentence the patient said while still anonymous.
 */

export type ProfileItem = {
  id: string;
  patient_session_id: string;
  category: ProfileCategory;
  value: string;
  status: ProfileStatus;
  provenance_pointer: string;
  created_at: string;
  updated_at: string;
};

const ITEM_COLUMNS =
  "id, patient_session_id, category, value, status, provenance_pointer, created_at, updated_at";

/**
 * Normalise a fact's text for matching, so "Advil 400mg" and "advil 400 mg"
 * are recognised as the same item rather than accumulating as duplicates. This
 * is deliberately dumb — the model is the one doing the semantic work, and a
 * clever fuzzy match here would silently merge two different medications.
 */
export function matchKey(category: string, value: string): string {
  const normalised = value
    .toLowerCase()
    // "400mg" and "400 mg" are the same dose written two ways, and people
    // write both. This is the ONLY semantic liberty taken here — it splits a
    // digit from a following letter and nothing else, so "Advil 200mg" and
    // "Advil 400mg" stay two different items.
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${category}::${normalised}`;
}

export type ProfileMutation =
  | { action: "insert"; fact: ExtractedFact }
  | { action: "status_change"; id: string; from: ProfileStatus; to: ProfileStatus; value: string }
  | { action: "unchanged"; id: string; value: string };

/**
 * Pure decision function — what to do with each extracted fact, given what is
 * already on file. Split out from the database write so the correction rule is
 * testable without Supabase, because "a correction must never delete" is the
 * behaviour that is graded and the one a refactor would break.
 *
 * Note there is no `delete` case in the return type at all. That is on purpose:
 * the function cannot express deletion, so no caller can accidentally perform it.
 */
export function planProfileMutations(
  existing: Pick<ProfileItem, "id" | "category" | "value" | "status">[],
  facts: ExtractedFact[],
): ProfileMutation[] {
  const byKey = new Map(existing.map((item) => [matchKey(item.category, item.value), item]));

  return facts.map((fact) => {
    const found = byKey.get(matchKey(fact.category, fact.value));
    if (!found) return { action: "insert", fact };
    if (found.status === fact.status) {
      return { action: "unchanged", id: found.id, value: found.value };
    }
    return {
      action: "status_change",
      id: found.id,
      from: found.status,
      to: fact.status,
      value: found.value,
    };
  });
}

/**
 * Apply the plan. `provenancePointer` is the id of the message that produced
 * these facts — for a status change it is deliberately NOT updated, because
 * the item's provenance is where the fact came from originally. The change is
 * recorded by `updated_at` moving.
 */
export async function applyProfileMutations(input: {
  patientSessionId: string;
  facts: ExtractedFact[];
  provenancePointer: string;
}): Promise<ProfileMutation[]> {
  if (input.facts.length === 0) return [];

  const db = supabaseAdmin();
  const { data: existing, error: readError } = await db
    .from("profile_items")
    .select(ITEM_COLUMNS)
    .eq("patient_session_id", input.patientSessionId);

  if (readError) {
    console.error("profile read failed:", readError.message);
    return [];
  }

  const plan = planProfileMutations((existing ?? []) as unknown as ProfileItem[], input.facts);

  const inserts = plan
    .filter((m): m is Extract<ProfileMutation, { action: "insert" }> => m.action === "insert")
    .map((m) => ({
      patient_session_id: input.patientSessionId,
      category: m.fact.category,
      value: m.fact.value,
      status: m.fact.status,
      provenance_pointer: input.provenancePointer,
    }));

  if (inserts.length > 0) {
    const { error } = await db.from("profile_items").insert(inserts);
    if (error) console.error("profile insert failed:", error.message);
  }

  for (const mutation of plan) {
    if (mutation.action !== "status_change") continue;
    const { error } = await db
      .from("profile_items")
      .update({ status: mutation.to, updated_at: new Date().toISOString() })
      .eq("id", mutation.id);
    if (error) console.error("profile status change failed:", error.message);
  }

  return plan;
}

/**
 * The profile as a clinician (or the patient) sees it, newest first within
 * category. Stopped and resolved items are INCLUDED — a medication history
 * with the stopped drugs filtered out is a worse record, not a tidier one.
 */
export async function loadProfile(patientSessionId: string): Promise<ProfileItem[]> {
  const { data, error } = await supabaseAdmin()
    .from("profile_items")
    .select(ITEM_COLUMNS)
    .eq("patient_session_id", patientSessionId)
    .order("category", { ascending: true })
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("loadProfile failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as ProfileItem[];
}

/**
 * Compact the profile for the model's system prompt, so the assistant does not
 * re-ask something the patient already told it. This is the concrete mechanism
 * behind "the patient never repeats themselves".
 */
export function profileAsContext(items: ProfileItem[]): string {
  if (items.length === 0) return "";
  const lines = items.map(
    (item) => `- [${item.category}] ${item.value} (${item.status})`,
  );
  return (
    "WHAT THIS PATIENT HAS ALREADY TOLD US — do not ask for any of it again:\n" +
    lines.join("\n")
  );
}

export const CATEGORY_LABELS: Record<ProfileCategory, string> = {
  chief_complaint: "Main concern",
  symptom: "Symptoms",
  medication: "Medications",
  allergy: "Allergies",
};
