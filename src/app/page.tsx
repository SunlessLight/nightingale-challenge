import Link from "next/link";
import { CLINIC_NAME } from "@/lib/clinic";

/**
 * The fake clinic homepage.
 *
 * This exists so `website_widget` is a REAL channel rather than a row in a
 * config table nobody can see — the floating bubble is a genuine fourth entry
 * point, and it gives the demo video an opening shot that looks like a clinic
 * rather than like a developer tool.
 *
 * The demo strip below it is scaffolding for the grader: the other three
 * channels arrive from an ad platform, a comment reply, or a staff member in
 * the real world, and there is no way to click those from here.
 */

const ENTRY_POINTS = [
  {
    href: "/start?source=instagram_ad_click&campaign=ivf_over40&creative=v2",
    label: "Instagram ad click",
    detail: "campaign ivf_over40, creative v2",
  },
  {
    href: "/start?source=social_comment",
    label: "Reply to a social comment",
    detail: "they commented on one of our posts",
  },
  {
    href: "/start?source=staff_referral&topic=fertility",
    label: "Staff referral link",
    detail: "topic fertility",
  },
  {
    href: "/start?source=google_ad_click&campaign=womens_health",
    label: "Google ad click",
    detail: "campaign womens_health",
  },
];

export default function Home() {
  return (
    <main className="flex-1">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-4">
          <span className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {CLINIC_NAME}
          </span>
          <span className="text-xs text-zinc-500">
            Petaling Jaya · Mon&ndash;Sat 8:00am&ndash;9:00pm
          </span>
        </div>
      </header>

      <section className="mx-auto max-w-4xl px-6 pt-16 pb-10">
        <h1 className="max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-50">
          Family medicine, women&rsquo;s health, and fertility care in Petaling Jaya.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-zinc-600 dark:text-zinc-400">
          Same-week appointments. Ask us anything first &mdash; you do not need to give us
          your details to get a straight answer.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Fertility &amp; IVF
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              First consults, cycle tracking, and referral onward. Most people start with a
              question, not an appointment.
            </p>
          </article>
          <article className="rounded-2xl border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              General &amp; women&rsquo;s health
            </h2>
            <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              Screening, contraception, and everyday illness. Walk in, or message us and we
              will tell you whether you need to come in at all.
            </p>
          </article>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-32">
        <div className="rounded-2xl border border-dashed border-zinc-300 p-5 dark:border-zinc-700">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-zinc-500">
            Demo &middot; the four ways someone arrives
          </p>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            In production these arrive from the ad platform or from a staff member. Each link
            creates a real anonymous lead session carrying its own attribution, and opens with
            a message chosen for that channel and the current time of day.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {ENTRY_POINTS.map((entry) => (
              <Link
                key={entry.href}
                href={entry.href}
                className="rounded-xl border border-zinc-200 px-4 py-3 transition hover:border-teal-600 dark:border-zinc-800"
              >
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {entry.label}
                </span>
                <span className="block text-xs text-zinc-500">{entry.detail}</span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* The fourth channel, as a real floating widget bubble. */}
      <Link
        href="/start?source=website_widget"
        className="fixed bottom-6 right-6 flex items-center gap-2.5 rounded-full bg-teal-700 px-5 py-3.5 text-sm font-medium text-white shadow-lg transition hover:bg-teal-800"
      >
        <span className="h-2 w-2 rounded-full bg-teal-300" />
        Ask the clinic a question
      </Link>
    </main>
  );
}
