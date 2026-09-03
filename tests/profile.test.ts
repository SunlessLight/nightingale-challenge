import { describe, expect, it } from "vitest";
import type { ExtractedFact } from "@/lib/anthropic";
import { matchKey, planProfileMutations, profileAsContext } from "@/lib/profile";
import type { ProfileItem } from "@/lib/profile";

/**
 * Phase 6's "memory mutation + provenance" test.
 *
 * The single behaviour under test: a correction changes STATUS, it never
 * deletes. Losing the row loses the provenance, and the provenance is the
 * thing that lets a clinician trust the profile at all.
 */

const existing = [
  { id: "item-advil", category: "medication" as const, value: "Advil 400mg", status: "active" as const },
  { id: "item-back", category: "symptom" as const, value: "Lower back ache", status: "active" as const },
];

const fact = (
  category: ExtractedFact["category"],
  value: string,
  status: ExtractedFact["status"],
): ExtractedFact => ({ category, value, status });

describe("corrections change status, never delete", () => {
  it("marks a stopped medication as stopped instead of removing it", () => {
    const plan = planProfileMutations(existing, [fact("medication", "Advil 400mg", "stopped")]);
    expect(plan).toEqual([
      { action: "status_change", id: "item-advil", from: "active", to: "stopped", value: "Advil 400mg" },
    ]);
  });

  it("cannot express a deletion at all", () => {
    // Structural, not incidental: the ProfileMutation union has no delete
    // case, so no caller can produce one even by mistake.
    const plan = planProfileMutations(existing, [
      fact("medication", "Advil 400mg", "stopped"),
      fact("symptom", "Lower back ache", "resolved"),
    ]);
    for (const mutation of plan) {
      expect(["insert", "status_change", "unchanged"]).toContain(mutation.action);
    }
  });

  it("marks a resolved symptom resolved and keeps it on file", () => {
    const plan = planProfileMutations(existing, [fact("symptom", "Lower back ache", "resolved")]);
    expect(plan[0]).toMatchObject({ action: "status_change", to: "resolved", id: "item-back" });
  });
});

describe("new facts are inserted", () => {
  it("inserts something never seen before", () => {
    const plan = planProfileMutations(existing, [fact("allergy", "Penicillin", "active")]);
    expect(plan[0]).toMatchObject({ action: "insert" });
  });

  it("does not churn a fact that has not changed", () => {
    const plan = planProfileMutations(existing, [fact("medication", "Advil 400mg", "active")]);
    expect(plan[0]).toMatchObject({ action: "unchanged", id: "item-advil" });
  });
});

describe("matching is normalised but not clever", () => {
  it("treats casing and spacing differences as the same item", () => {
    expect(matchKey("medication", "Advil 400mg")).toBe(matchKey("medication", "  advil   400 MG "));
  });

  it("keeps the same words in different categories apart", () => {
    // "Penicillin" as an allergy is a completely different clinical fact from
    // "Penicillin" as a current medication. Merging them would be dangerous.
    expect(matchKey("allergy", "Penicillin")).not.toBe(matchKey("medication", "Penicillin"));
  });

  it("does not merge two genuinely different medications", () => {
    const plan = planProfileMutations(existing, [fact("medication", "Advil 200mg", "active")]);
    expect(plan[0]).toMatchObject({ action: "insert" });
  });
});

describe("profile context given to the model", () => {
  const items: ProfileItem[] = [
    {
      id: "1",
      patient_session_id: "p",
      category: "medication",
      value: "Advil 400mg",
      status: "stopped",
      provenance_pointer: "msg-1",
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-02T00:00:00Z",
    },
  ];

  it("tells the model not to re-ask, and includes stopped items", () => {
    const context = profileAsContext(items);
    expect(context).toContain("do not ask for any of it again");
    // A stopped medication is still history the assistant must not re-ask about.
    expect(context).toContain("Advil 400mg");
    expect(context).toContain("stopped");
  });

  it("is empty when there is nothing on file", () => {
    expect(profileAsContext([])).toBe("");
  });
});
