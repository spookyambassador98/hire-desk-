import { AppShell } from "@/components/AppShell";
import { deskPayload } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function HomePage() {
  try {
    const { jobs, individuals, quota } = await deskPayload();
    return (
      <AppShell
        initialJobs={jobs}
        initialIndividuals={individuals}
        initialQuota={quota}
      />
    );
  } catch (err) {
    console.error("[page] deskPayload crash", err);
    return (
      <AppShell
        initialJobs={[]}
        initialIndividuals={[]}
        initialQuota={{
          europe: { used: 0, quota: 10, remaining: 10 },
          america: { used: 0, quota: 10, remaining: 10 },
          asia: { used: 0, quota: 10, remaining: 10 },
          individuals: { used: 0, quota: 4, remaining: 4 },
        }}
      />
    );
  }
}
