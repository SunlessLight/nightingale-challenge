import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

/**
 * Three clients, deliberately separate.
 *
 * `supabasePublic()` uses the publishable (anon) key and is subject to Row
 * Level Security — every table in 0001_init.sql has RLS enabled, so this
 * client sees only rows a policy lets it see.
 *
 * `supabaseAdmin()` uses the secret key and *bypasses RLS entirely*. It is a
 * server-only escape hatch for trusted paths (writing an audit log, reading a
 * consented patient on behalf of staff). It throws if it is ever constructed
 * in a browser, because the alternative failure is silent.
 *
 * `supabaseBrowser()` is the signed-in patient's own client. It carries their
 * auth session, so `auth.uid()` is populated inside every policy — this is the
 * client the patient dashboard reads through, which is what makes access
 * control a real enforced property rather than a claim in the README.
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

/**
 * Browser-only env read.
 *
 * `requireEnv()` indexes `process.env` DYNAMICALLY. Next.js inlines only
 * *literal* `process.env.NEXT_PUBLIC_X` member expressions into the client
 * bundle, so a computed lookup survives the build as a lookup — and
 * `process.env` is an empty object in the browser. The literals below are the
 * only form the bundler can see. Do not "tidy" these into requireEnv().
 */
function publicEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not " +
        "in the client bundle. They are inlined at BUILD time — set them in " +
        "Vercel and redeploy.",
    );
  }
  return { url, key };
}

/**
 * One memoised client per tab. Supabase warns (and can desynchronise token
 * refresh) if several GoTrue instances share a storage key, so this is a
 * singleton rather than a factory.
 */
let browserClient: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, key } = publicEnv();
  browserClient = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storageKey: "nightingale-auth",
    },
  });
  return browserClient;
}

/**
 * A deliberately signed-OUT anon client, used to prove access control from the
 * patient's own browser: same key, same tables, no session. Anything it can
 * read, a stranger on the internet can read. A separate storageKey keeps it
 * from ever picking up the patient's tokens.
 */
export function supabaseStranger(): SupabaseClient {
  const { url, key } = publicEnv();
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      storageKey: "nightingale-stranger",
    },
  });
}
