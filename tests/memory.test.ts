import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedFact } from "@/lib/anthropic";

/**
 * Phase 6's "memory mutation + provenance" test — the PROVENANCE half.
 *
 * tests/profile.test.ts tests planProfileMutations(), which is pure and
 * decides WHAT should happen. This file tests applyProfileMutations(), which
 * decides what actually reaches the database — and provenance lives entirely
 * on that side:
 *
 *   - an INSERT stamps the id of the message the fact came from;
 *   - a STATUS CHANGE must NOT touch provenance_pointer, because the item's
 *     provenance is where the fact came from ORIGINALLY. "I stopped Advil"
 *     changes the status; it does not change the sentence that first told us
 *     about Advil, which may well have been said while the person was still
 *     anonymous.
 *   - nothing, ever, issues a delete.
 *
 * Supabase is faked rather than mocked loosely: the fake CAPTURES the payloads
 * so the assertions are about the exact rows written, and its `delete` method
 * throws, so a deletion cannot pass silently as an untested path.
 */

const db = vi.hoisted(() => ({
  existing: [] as Record<string, unknown>[],
  inserts: [] as Record<string, unknown>[],
  updates: [] as { id: unknown; payload: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase", () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: db.existing, error: null }) }),
      insert: async (rows: Record<string, unknown>[]) => {
        db.inserts.push(...rows);
        return { error: null };
      },
      update: (payload: Record<string, unknown>) => ({
        eq: async (_column: string, id: unknown) => {
          db.updates.push({ id, payload });
          return { error: null };
        },
      }),
      delete: () => {
        throw new Error("profile_items must never be deleted — a correction is a status change.");
      },
    }),
  }),
}));

const { applyProfileMutations } = await import("@/lib/profile");

const PATIENT = "11111111-2222-3333-4444-555555555555";
/** The message the fact was FIRST said in — while the person was still a guest. */
const GUEST_MESSAGE = "aaaaaaaa-0000-0000-0000-000000000001";
/** A much later message, in which they correct themselves. */
const CORRECTION_MESSAGE = "bbbbbbbb-0000-0000-0000-000000000002";

const advilOnFile = {
  id: "item-advil",
  patient_session_id: PATIENT,
  category: "medication",
  value: "Advil (ibuprofen) 400mg twice daily",
  status: "active",
  provenance_pointer: GUEST_MESSAGE,
  created_at: "2026-09-03T03:07:22.000Z",
  updated_at: "2026-09-03T03:07:22.000Z",
};

const fact = (
  category: ExtractedFact["category"],
  value: string,
  status: ExtractedFact["status"],
): ExtractedFact => ({ category, value, status });

beforeEach(() => {
  db.existing = [];
  db.inserts = [];
  db.updates = [];
});

describe("a new fact is stamped with the message it came from", () => {
  it("writes provenance_pointer = the id of the patient's own message", () => {
    // This is what makes every line of the profile panel able to say
    // "because you said: ...". Without it the profile is an assertion.
    return applyProfileMutations({
      patientSessionId: PATIENT,
      facts: [fact("allergy", "Penicillin", "active")],
      provenancePointer: GUEST_MESSAGE,
    }).then(() => {
      expect(db.inserts).toHaveLength(1);
      expect(db.inserts[0]).toMatchObject({
        patient_session_id: PATIENT,
        category: "allergy",
        value: "Penicillin",
        status: "active",
        provenance_pointer: GUEST_MESSAGE,
      });
    });
  });

  it("stamps every fact from one message with that same message", async () => {
    await applyProfileMutations({
      patientSessionId: PATIENT,
      facts: [
        fact("chief_complaint", "Crushing chest pain", "active"),
        fact("medication", "Advil (ibuprofen) 400mg twice daily", "active"),
        fact("allergy", "Penicillin", "active"),
      ],
      provenancePointer: GUEST_MESSAGE,
    });
    expect(db.inserts).toHaveLength(3);
    for (const row of db.inserts) {
      expect(row.provenance_pointer).toBe(GUEST_MESSAGE);
    }
  });
});

describe("a correction changes status and LEAVES PROVENANCE ALONE", () => {
  beforeEach(() => {
    db.existing = [advilOnFile];
  });

  it("issues an update, not an insert", async () => {
    const plan = await applyProfileMutations({
      patientSessionId: PATIENT,
      facts: [fact("medication", "Advil (ibuprofen) 400mg twice daily", "stopped")],
      provenancePointer: CORRECTION_MESSAGE,
    });
    expect(plan).toEqual([
      {
        action: "status_change",
        id: "item-advil",
        from: "active",
        to: "stopped",
        value: "Advil (ibuprofen) 400mg twice daily",
      },
    ]);
    expect(db.inserts).toHaveLength(0);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0].id).toBe("item-advil");
  });

  it("writes ONLY status and updated_at", async () => {
    await applyProfileMutations({
      patientSessionId: PATIENT,
      facts: [fact("medication", "Advil (ibuprofen) 400mg twice daily", "stopped")],
      provenancePointer: CORRECTION_MESSAGE,
    });
    const payload = db.updates[0].payload;
    expect(payload.status).toBe("stopped");
    expect(typeof payload.updated_at).toBe("string");
    // THE ASSERTION THIS FILE EXISTS FOR. Re-pointing provenance at the
    // correction would make the record claim the patient first mentioned Advil
    // in the message where they stopped it, and the "because you said" line
    // under it would quote the wrong sentence.
    expect(payload).not.toHaveProperty("provenance_pointer");
    expect(Object.keys(payload).sort()).toEqual(["status", "updated_at"]);
  });

  it("keeps a fact first said as a GUEST pointing at the guest message", async () => {
    // Conversion re-points messages rather than copying them, so
    // GUEST_MESSAGE is still a live row after signup. A status change written
    // months later must not overwrite that link.
    await applyProfileMutations({
      patientSessionId: PATIENT,
      facts: [fact("medication", "Advil (ibuprofen) 400mg twice daily", "stopped")],
      provenancePointer: CORRECTION_MESSAGE,
    });
    expect(JSON.stringify(db.updates)).not.toContain(CORRECTION_MESSAGE);
    expect(advilOnFile.provenance_pointer).toBe(GUEST_MESSAGE);
  });

  it("never calls delete — the fake throws if anything tries", async () => {
    await expect(
      applyProfileMutations({
        patientSessionId: PATIENT,
        facts: [
          fact("medication", "Advil (ibuprofen) 400mg twice daily", "stopped"),
          fact("symptom", "Lower back ache", "resolved"),
        ],
        provenancePointer: CORRECTION_MESSAGE,
      }),
    ).resolves.toBeDefined();
  });
});

describe("a value the model rewrote becomes a NEW row, not a silent overwrite", () => {
  // The known open item in timeline.md, pinned as a test so its behaviour is
  // documented rather than discovered. Matching is a soft join on the
  // model-authored value string: a value that drifts by one clause inserts a
  // second row. That is the SAFE failure — two rows a clinician can see and
  // reconcile, rather than one row quietly overwritten — but it is a failure,
  // and the structural fix is to have the model echo back a stable item id.
  beforeEach(() => {
    db.existing = [advilOnFile];
  });

  it("inserts rather than overwriting when the value drifts", async () => {
    await applyProfileMutations({
      patientSessionId: PATIENT,
      facts: [
        fact("medication", "Advil (ibuprofen) 400mg twice daily — stopped last week", "stopped"),
      ],
      provenancePointer: CORRECTION_MESSAGE,
    });
    expect(db.inserts).toHaveLength(1);
    expect(db.updates).toHaveLength(0);
    // The original row is untouched, so nothing is lost — the record just has
    // two entries the clinician has to read together.
    expect(db.inserts[0].provenance_pointer).toBe(CORRECTION_MESSAGE);
  });
});

describe("nothing is written when the model extracted nothing", () => {
  it("short-circuits before touching the database", async () => {
    const plan = await applyProfileMutations({
      patientSessionId: PATIENT,
      facts: [],
      provenancePointer: CORRECTION_MESSAGE,
    });
    expect(plan).toEqual([]);
    expect(db.inserts).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  it("does not churn a fact that has not changed", async () => {
    db.existing = [advilOnFile];
    await applyProfileMutations({
      patientSessionId: PATIENT,
      facts: [fact("medication", "Advil (ibuprofen) 400mg twice daily", "active")],
      provenancePointer: CORRECTION_MESSAGE,
    });
    expect(db.inserts).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });
});
