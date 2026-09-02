/**
 * The environment contract.
 *
 * Two jobs, both about the boundary between browser and server:
 *  1. Fail loudly and by name when a variable is missing, rather than sending
 *     `undefined` to Supabase or Anthropic and reading a vague 401 later.
 *  2. Catch a server-only secret that has been pasted into a `NEXT_PUBLIC_`
 *     variable. Next.js inlines every `NEXT_PUBLIC_*` value into the browser
 *     bundle at build time, so that mistake ships the key to every visitor
 *     and cannot be undone by editing the variable afterwards.
 */

/** Inlined into the client bundle at build time. Safe to expose. */
export const PUBLIC_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

/** Server-only. SUPABASE_SECRET_KEY bypasses RLS; ANTHROPIC_API_KEY is billable. */
export const SERVER_ENV_KEYS = [
  "SUPABASE_SECRET_KEY",
  "ANTHROPIC_API_KEY",
] as const;

export type EnvSource = Record<string, string | undefined>;

export type EnvReport = {
  /** Names declared in .env.example that are absent or blank. */
  missing: string[];
  /** Human-readable descriptions of a server secret exposed via NEXT_PUBLIC_*. */
  leaked: string[];
  ok: boolean;
};

const isBlank = (value: string | undefined) => value === undefined || value.trim() === "";

export function auditEnv(source: EnvSource): EnvReport {
  const missing = [...PUBLIC_ENV_KEYS, ...SERVER_ENV_KEYS].filter((key) =>
    isBlank(source[key]),
  );

  // Compare by *value*, not by name: the realistic failure is pasting the
  // secret key into the wrong Vercel field, where the name looks innocent.
  const leaked: string[] = [];
  for (const serverKey of SERVER_ENV_KEYS) {
    const secret = source[serverKey];
    if (isBlank(secret)) continue;
    for (const [name, value] of Object.entries(source)) {
      if (name.startsWith("NEXT_PUBLIC_") && value === secret) {
        leaked.push(`${name} holds the value of ${serverKey}`);
      }
    }
  }

  return { missing, leaked, ok: missing.length === 0 && leaked.length === 0 };
}

/** Read one variable or throw naming it. Use at the point of use, not at import. */
export function requireEnv(name: string, source: EnvSource = process.env): string {
  const value = source[name];
  if (isBlank(value)) {
    throw new Error(
      `Missing environment variable ${name}. Add it to .env locally and to ` +
        `Vercel → Settings → Environment Variables, then redeploy (values are ` +
        `read at build time).`,
    );
  }
  return value as string;
}
