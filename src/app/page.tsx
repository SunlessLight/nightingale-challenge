export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="w-full max-w-xl">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-zinc-500">
          Nightingale
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Someone reaches out. We answer straight away.
        </h1>
        <p className="mt-4 text-base leading-7 text-zinc-600 dark:text-zinc-400">
          A clinic front door that helps before it asks for anything — then hands
          you to a real clinician the moment that is the right call.
        </p>
        <p className="mt-10 text-sm text-zinc-500">
          Phase 1 · scaffold, schema, and deploy. Guest chat lands next.
        </p>
      </div>
    </main>
  );
}
