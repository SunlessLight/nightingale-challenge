import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  IDENTITY_LEVELS,
  OPENING_RULES,
  parseChannel,
  resolveOpening,
  timeOfDay,
  type TimeOfDay,
} from "@/lib/channels";

const at = (utcIso: string) => new Date(utcIso);

describe("timeOfDay() — clinic timezone, not server timezone", () => {
  it("buckets by Kuala Lumpur local time", () => {
    expect(timeOfDay(at("2026-09-02T01:00:00Z"))).toBe("morning"); // 09:00 KL
    expect(timeOfDay(at("2026-09-02T06:00:00Z"))).toBe("afternoon"); // 14:00 KL
    expect(timeOfDay(at("2026-09-02T10:00:00Z"))).toBe("evening"); // 18:00 KL
    expect(timeOfDay(at("2026-09-02T16:00:00Z"))).toBe("after_hours"); // 00:00 KL
  });

  /**
   * The bug this function exists to prevent. Vercel runs UTC, 8 hours behind
   * the clinic. At 01:00 UTC a naive getHours() says "after hours" while the
   * patient is standing in a waiting room at 9am.
   */
  it("does not greet a 9am patient with the after-hours message", () => {
    const nineAmInKL = at("2026-09-02T01:00:00Z");
    expect(nineAmInKL.getUTCHours()).toBe(1); // naive server hour
    expect(timeOfDay(nineAmInKL)).not.toBe("after_hours");
  });

  it("handles the midnight boundary without wrapping to hour 24", () => {
    expect(timeOfDay(at("2026-09-02T16:00:00Z"))).toBe("after_hours");
    // 07:59 KL is still before the 8am open, so it is correctly after_hours.
    expect(timeOfDay(at("2026-09-01T23:59:00Z"))).toBe("after_hours");
    expect(timeOfDay(at("2026-09-02T00:00:00Z"))).toBe("morning"); // 08:00 KL, the boundary
  });
});

describe("parseChannel()", () => {
  it("accepts every canonical channel the database CHECK constraint allows", () => {
    for (const channel of CHANNELS) expect(parseChannel(channel)).toBe(channel);
  });

  it("normalises friendly aliases to the canonical value", () => {
    expect(parseChannel("instagram_ad")).toBe("instagram_ad_click");
    expect(parseChannel("google_ad")).toBe("google_ad_click");
    expect(parseChannel("WIDGET")).toBe("website_widget");
  });

  it("rejects anything else rather than inventing a channel", () => {
    expect(parseChannel("tiktok_ad")).toBeNull();
    expect(parseChannel("")).toBeNull();
    expect(parseChannel(null)).toBeNull();
  });
});

describe("resolveOpening() — the rules table", () => {
  const base = { identityLevel: "anonymous", timeOfDay: "morning" } as const;

  it("is total: every channel x identity x time combination returns a message", () => {
    const times: TimeOfDay[] = ["morning", "afternoon", "evening", "after_hours"];
    for (const channel of CHANNELS) {
      for (const identityLevel of IDENTITY_LEVELS) {
        for (const t of times) {
          const opening = resolveOpening({ channel, identityLevel, timeOfDay: t });
          expect(opening.length).toBeGreaterThan(20);
        }
      }
    }
  });

  it("gives each channel a distinguishable greeting during opening hours", () => {
    const staff = resolveOpening({ ...base, channel: "staff_referral", topic: "fertility" });
    const social = resolveOpening({ ...base, channel: "social_comment" });
    const ad = resolveOpening({ ...base, channel: "instagram_ad_click", campaign: "ivf_over40" });
    const widget = resolveOpening({ ...base, channel: "website_widget" });

    expect(new Set([staff, social, ad, widget]).size).toBe(4);
    expect(staff).toContain("fertility");
    expect(ad).toContain("ivf over40");
    expect(social).toMatch(/post/i);
  });

  it("falls back gracefully when a staff referral carries no topic", () => {
    const opening = resolveOpening({ ...base, channel: "staff_referral", topic: null });
    expect(opening).not.toContain("null");
    expect(opening).not.toContain("undefined");
  });

  /**
   * The after-hours row is deliberately first so it outranks channel flavour.
   * Sounding like a human is standing by at 2am is a small lie, and this
   * product is graded on trustworthiness.
   */
  it("after-hours honesty outranks every channel greeting", () => {
    for (const channel of CHANNELS) {
      const opening = resolveOpening({
        channel,
        identityLevel: "anonymous",
        timeOfDay: "after_hours",
      });
      expect(opening).toMatch(/closed/i);
    }
  });

  it("never claims to be a human", () => {
    // Both branches of every templated rule, so a disclosure cannot hide in
    // the variant that happens not to be exercised.
    for (const channel of CHANNELS) {
      for (const extra of [{}, { topic: "fertility", campaign: "ivf_over40" }]) {
        const opening = resolveOpening({ ...base, channel, ...extra });
        expect(opening, `${channel} ${JSON.stringify(extra)}`).toMatch(/AI assistant/i);
      }
    }
  });

  it("keeps the last rule matcher-free so the table cannot fall through", () => {
    const last = OPENING_RULES[OPENING_RULES.length - 1];
    expect(last.channel).toBeUndefined();
    expect(last.identityLevel).toBeUndefined();
    expect(last.timeOfDay).toBeUndefined();
  });
});
