import { describe, expect, it } from "vitest";
import { auditEnv, requireEnv } from "@/lib/env";

const complete = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_xxx",
  SUPABASE_SECRET_KEY: "sb_secret_yyy",
  ANTHROPIC_API_KEY: "sk-ant-zzz",
};

describe("auditEnv", () => {
  it("passes when all four variables are present", () => {
    expect(auditEnv(complete)).toEqual({ missing: [], leaked: [], ok: true });
  });

  it("names every missing variable rather than failing at first use", () => {
    const report = auditEnv({ NEXT_PUBLIC_SUPABASE_URL: complete.NEXT_PUBLIC_SUPABASE_URL });
    expect(report.ok).toBe(false);
    expect(report.missing).toEqual([
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_SECRET_KEY",
      "ANTHROPIC_API_KEY",
    ]);
  });

  it("treats a blank value as missing, not as set", () => {
    expect(auditEnv({ ...complete, ANTHROPIC_API_KEY: "   " }).missing).toEqual([
      "ANTHROPIC_API_KEY",
    ]);
  });

  it("catches a server secret pasted into a NEXT_PUBLIC_ variable", () => {
    // NEXT_PUBLIC_* is inlined into the browser bundle at build time, so this
    // mistake publishes the RLS-bypassing key to every visitor.
    const report = auditEnv({
      ...complete,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: complete.SUPABASE_SECRET_KEY,
    });
    expect(report.ok).toBe(false);
    expect(report.leaked).toEqual([
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds the value of SUPABASE_SECRET_KEY",
    ]);
  });
});

describe("requireEnv", () => {
  it("returns the value when set", () => {
    expect(requireEnv("ANTHROPIC_API_KEY", complete)).toBe("sk-ant-zzz");
  });

  it("throws naming the variable when unset", () => {
    expect(() => requireEnv("ANTHROPIC_API_KEY", {})).toThrow(/ANTHROPIC_API_KEY/);
  });
});
