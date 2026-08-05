"use client";

import { useEffect, useState } from "react";
import type { QuotaSnapshot, ScoredIndividual, ScoredJob } from "@/lib/types";

type Props = {
  jobs: ScoredJob[];
  individuals: ScoredIndividual[];
  quota: QuotaSnapshot;
};

type HarvestStatus = {
  storage?: string;
  firebase?: { ok: boolean; projectId?: string; error?: string } | null;
  proxyPool?: number;
  sources?: Array<{ id: string; label: string; tier: string }>;
  totalToday?: number;
  runTarget?: number;
  mode?: string;
};

export function AdminPanel({ jobs, individuals, quota }: Props) {
  const [status, setStatus] = useState<HarvestStatus | null>(null);

  useEffect(() => {
    void fetch("/api/harvest/status", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStatus(d as HarvestStatus))
      .catch(() => setStatus(null));
  }, []);

  const funnel = {
    new: jobs.filter((j) => j.status === "new").length,
    queued: jobs.filter((j) => j.status === "queued").length,
    applied: jobs.filter((j) => j.status === "applied").length,
    follow_up: jobs.filter((j) => j.status === "follow_up").length,
    interview: jobs.filter((j) => j.status === "interview").length,
    offer: jobs.filter((j) => j.status === "offer").length,
    rejected: jobs.filter((j) => j.status === "rejected").length,
  };

  const indFunnel = {
    new: individuals.filter((i) => i.status === "new").length,
    queued: individuals.filter((i) => i.status === "queued").length,
    emailed: individuals.filter((i) => i.status === "emailed").length,
    replied: individuals.filter((i) => i.status === "replied").length,
  };

  const withEmail = individuals.filter((i) => i.email).length;
  const avgFit =
    jobs.length === 0
      ? 0
      : Math.round(
          jobs.reduce((n, j) => n + j.scores.fit.score, 0) / jobs.length,
        );

  return (
    <div className="hd-panel">
      <div className="hd-rail us" style={{ marginBottom: "1rem" }}>
        <h2>Admin // ops</h2>
        <p>
          Jobs {jobs.length} · individuals {individuals.length} · avg Fit{" "}
          {avgFit}
        </p>
      </div>

      <div className="hd-stats">
        <div className="hd-stat">
          <span>Storage</span>
          <b>{status?.storage || "…"}</b>
        </div>
        <div className="hd-stat">
          <span>Firebase</span>
          <b>
            {status?.firebase?.ok
              ? status.firebase.projectId || "ok"
              : status?.firebase?.error || "—"}
          </b>
        </div>
        <div className="hd-stat">
          <span>Proxy</span>
          <b>{status?.proxyPool ?? 0}</b>
        </div>
        <div className="hd-stat">
          <span>Harvest today</span>
          <b>
            {status?.totalToday ?? 0}/{status?.runTarget ?? "—"}
          </b>
        </div>
      </div>

      <div className="hd-dual" style={{ marginBottom: "1rem" }}>
        <section className="hd-rail eu">
          <h2>Job pipeline</h2>
          <div className="hd-stats" style={{ marginTop: "0.75rem" }}>
            {Object.entries(funnel).map(([k, v]) => (
              <div key={k} className="hd-stat">
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="hd-rail us">
          <h2>Individuals</h2>
          <p style={{ marginTop: "0.35rem" }}>
            with email {withEmail}/{individuals.length}
          </p>
          <div className="hd-stats" style={{ marginTop: "0.75rem" }}>
            {Object.entries(indFunnel).map(([k, v]) => (
              <div key={k} className="hd-stat">
                <span>{k}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="hd-stats" style={{ marginBottom: "1rem" }}>
        <div className="hd-stat">
          <span>EU quota</span>
          <b>
            {quota.europe.used}/{quota.europe.quota}
          </b>
        </div>
        <div className="hd-stat">
          <span>US quota</span>
          <b>
            {quota.america.used}/{quota.america.quota}
          </b>
        </div>
        <div className="hd-stat">
          <span>IND quota</span>
          <b>
            {quota.individuals.used}/{quota.individuals.quota}
          </b>
        </div>
      </div>

      {status?.sources && (
        <section className="hd-rail">
          <h2>Sources live</h2>
          <div className="job-meta" style={{ marginTop: "0.65rem" }}>
            {status.sources.map((s) => (
              <span key={s.id} className="job-chip">
                {s.tier}:{s.id}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
