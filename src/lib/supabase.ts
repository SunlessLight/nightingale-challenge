import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Two clients, deliberately separate.
 *
 * `supabasePublic()` uses the publishable (anon) key and is subject to Row
 * Level Security — every table in 0001_init.sql has RLS enabled, so this
 * client sees only rows a policy lets it see.
 *
 * `supabaseAdmin()` uses the secret key and *bypasses RLS entirely*. It is a
 * server-only escape hatch for trusted paths (writing an audit log, reading a
 * consented patient on behalf of staff). It throws if it is ever constructed
 * in a browser, because the alternative failure is silent.
 */

export function supabasePublic(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  );
}

export function supabaseAdmin(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error(
      "supabaseAdmin() was called in the browser. The secret key bypasses RLS " +
        "and must never leave the server.",
    );
  }
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SECRET_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
