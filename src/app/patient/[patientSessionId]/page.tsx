import Link from "next/link";
import PatientDashboard from "@/components/PatientDashboard";
import { CLINIC_NAME } from "@/lib/clinic";

/**
 * Deliberately a thin shell. The page does NOT server-render the patient's
 * data with the admin key — if it did, anyone holding the URL would see the
 * record, and access control would be "the id is hard to guess" rather than a
 * policy. Everything below the header is fetched client-side through the
 * patient's own RLS-bound session.
 */
export const dynamic = "force-dynamic";

export default async function PatientPage({ params }: PageProps<"/patient/[patientSessionId]">) {
  const { patientSessionId } = await params;

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-5 py-10">
      <div className="mb-5">
        <Link href="/" className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {CLINIC_NAME}
        </Link>
        <p className="mt-0.5 text-xs text-zinc-500">Your record</p>
      </div>

      <PatientDashboard patientSessionId={patientSessionId} />

      <p className="mt-5 text-xs leading-5 text-zinc-500">
        If this is an emergency, exit Nightingale and dial <strong>999</strong>.
      </p>
    </main>
  );
}
