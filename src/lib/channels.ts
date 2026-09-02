import { CLINIC_NAME, CLINIC_OPENS } from "@/lib/clinic";

/**
 * Channel rules as ONE table, not scattered if-statements.
 *
 * The brief asks for behaviour that varies by channel x identity x time of
 * day. Written as branching code that is three nested conditionals nobody can
 * audit; written as a table it is a list a non-engineer can read, and every
 * row is a product decision someone can disagree with out loud.
 *
 * First match wins, and the last row has no matchers at all, which makes
 * `resolveOpening()` total — there is no input that returns undefined.
 */

export const CHANNELS = [
  "staff_referral",
  "social_comment",
  "instagram_ad_click",
  "google_ad_click",
  "website_widget",
] as const;
export type Channel = (typeof CHANNELS)[number];

export const IDENTITY_LEVELS = ["anonymous", "contactable", "identified"] as const;
export type IdentityLevel = (typeof IDENTITY_LEVELS)[number];

export type TimeOfDay = "morning" | "afternoon" | "evening" | "after_hours";

/**
 * Friendly aliases accepted on the /start URL. The database CHECK constraint
 * only knows the canonical five, so anything a marketer might plausibly paste
 * into an ad gets normalised here rather than failing an insert at 2am.
 */
const CHANNEL_ALIASES: Record<string, Channel> = {
  instagram_ad: "instagram_ad_click",
  ig_ad: "instagram_ad_click",
  google_ad: "google_ad_click",
  widget: "website_widget",
  website: "website_widget",
  staff: "staff_referral",
  comment: "social_comment",
};

/** Returns the canonical channel, or null if the value is not one we accept. */
export function parseChannel(raw: string | null | undefined): Channel | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if ((CHANNELS as readonly string[]).includes(key)) return key as Channel;
  return CHANNEL_ALIASES[key] ?? null;
}

/**
 * Time buckets in the CLINIC's timezone, not the server's.
 *
 * Vercel runs in UTC, 8 hours behind Kuala Lumpur. A naive
 * `new Date().getHours()` would greet a patient arriving at 9am local with the
 * after-hours message, which is exactly the kind of small wrongness that makes
 * an assistant feel untrustworthy. `Intl` does the conversion including any
 * future DST rule change, which hand-rolled arithmetic would not.
 *
 * `now` is injectable so this is testable without mocking the clock.
 */
export const CLINIC_TIMEZONE = "Asia/Kuala_Lumpur";

export function timeOfDay(now: Date = new Date()): TimeOfDay {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: CLINIC_TIMEZONE,
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);

  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;

  if (hour >= 8 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "after_hours";
}

export type OpeningContext = {
  channel: Channel;
  identityLevel: IdentityLevel;
  timeOfDay: TimeOfDay;
  /** staff_referral only: what the staff member said this was about. */
  topic?: string | null;
  /** ad channels only: the campaign that paid for this click. */
  campaign?: string | null;
};

type Rule = {
  /** Why this row exists. Shown in the technical brief's ethics table. */
  note: string;
  channel?: readonly Channel[];
  identityLevel?: readonly IdentityLevel[];
  timeOfDay?: readonly TimeOfDay[];
  opening: (ctx: OpeningContext) => string;
};

const humanise = (slug: string) => slug.replace(/[_-]+/g, " ").trim();

export const OPENING_RULES: readonly Rule[] = [
  {
    // Deliberately FIRST, so it outranks every channel-specific greeting.
    // This is a trust decision, not a cosmetic one: at 2am, sounding like a
    // human is standing by is a small lie, and the whole product is graded on
    // whether it feels trustworthy.
    note: "After hours: say the clinic is closed rather than implying someone is watching live.",
    timeOfDay: ["after_hours"],
    opening: () =>
      `${CLINIC_NAME} is closed right now — we open at ${CLINIC_OPENS}. ` +
      `I am an AI assistant, so I can still help you think this through, and a real person ` +
      `will see anything you send in the morning. What is going on?`,
  },
  {
    note: "Returning identified patient (Phase 3+): never re-ask what we already know.",
    identityLevel: ["identified"],
    opening: () =>
      `Welcome back. I still have everything you told us last time, so you do not need to ` +
      `repeat yourself. What has changed?`,
  },
  {
    note: "Staff referral with a topic: the warmest entry — pick up mid-conversation.",
    channel: ["staff_referral"],
    opening: (ctx) =>
      ctx.topic
        ? `Someone at ${CLINIC_NAME} pointed you here about ${humanise(ctx.topic)}. ` +
          `I am the clinic's AI assistant — ask me anything about it. No sign-up, and ` +
          `nothing reaches the clinic until you choose to send it.`
        : `Someone at ${CLINIC_NAME} pointed you here. I am the clinic's AI assistant — ` +
          `ask me anything, no sign-up needed.`,
  },
  {
    note: "Social comment: they engaged publicly, so acknowledge that and drop the friction.",
    channel: ["social_comment"],
    opening: () =>
      `Thanks for commenting on our post — sorry it took a moment. I am ${CLINIC_NAME}'s ` +
      `AI assistant. Ask me your question here and I will give you a straight answer, ` +
      `before we ask you for anything at all.`,
  },
  {
    note: "Paid click: they are cold and sceptical. Lead with what they get, not with a form.",
    channel: ["instagram_ad_click", "google_ad_click"],
    opening: (ctx) =>
      `Thanks for coming through${ctx.campaign ? ` from our ${humanise(ctx.campaign)} page` : ""}. ` +
      `Before ${CLINIC_NAME} asks you for a single detail — what would you like to know? ` +
      `I am an AI assistant and this is free.`,
  },
  {
    // No matchers: the guaranteed default that makes resolveOpening total.
    note: "Website widget and fallback.",
    opening: () =>
      `Hi — I am ${CLINIC_NAME}'s AI assistant. Ask me anything about symptoms, ` +
      `appointments, or what to expect. No sign-up, and no details needed to start.`,
  },
];

const matches = <T,>(allowed: readonly T[] | undefined, value: T) =>
  allowed === undefined || allowed.includes(value);

/** Total function: some rule always matches, because the last one has no matchers. */
export function resolveOpening(ctx: OpeningContext): string {
  const rule = OPENING_RULES.find(
    (r) =>
      matches(r.channel, ctx.channel) &&
      matches(r.identityLevel, ctx.identityLevel) &&
      matches(r.timeOfDay, ctx.timeOfDay),
  );
  // Non-null assertion is safe by construction; the final rule matches everything.
  return rule!.opening(ctx);
}
