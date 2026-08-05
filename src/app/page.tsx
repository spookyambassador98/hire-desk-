import { AppShell } from "@/components/AppShell";
import { deskPayload } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  const { jobs, individuals, quota } = await deskPayload();
  return (
    <AppShell
      initialJobs={jobs}
      initialIndividuals={individuals}
      initialQuota={quota}
    />
  );
}
