"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AddIndividualModal } from "@/components/AddIndividualModal";
import { AddJobModal } from "@/components/AddJobModal";
import { HarvestPanel } from "@/components/HarvestPanel";
import { IndividualCard } from "@/components/IndividualCard";
import { JobCard } from "@/components/JobCard";
import { sortAppliedWithFollowUps } from "@/lib/followUp";
import { TEMPLATES } from "@/lib/templates";
import type {
  AppView,
  IndividualStatus,
  JobStatus,
  QuotaSnapshot,
  ScoredIndividual,
  ScoredJob,
} from "@/lib/types";

type Props = {
  initialJobs: ScoredJob[];
  initialIndividuals: ScoredIndividual[];
  initialQuota: QuotaSnapshot;
};

const NAV: Array<{ id: AppView; label: string; us?: boolean }> = [
  { id: "queue", label: "Queue" },
  { id: "europe", label: "Europe" },
  { id: "america", label: "America", us: true },
  { id: "individuals", label: "Individuals" },
  { id: "applied", label: "Applied" },
  { id: "harvest", label: "Harvest" },
  { id: "templates", label: "Templates" },
];

export function HireDesk({
  initialJobs,
  initialIndividuals,
  initialQuota,
}: Props) {
  const [view, setView] = useState<AppView>("queue");
  const [jobs, setJobs] = useState(initialJobs);
  const [individuals, setIndividuals] = useState(initialIndividuals);
  const [quota, setQuota] = useState(initialQuota);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [addIndOpen, setAddIndOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function flash(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2800);
  }

  function applyPayload(data: {
    jobs?: ScoredJob[];
    individuals?: ScoredIndividual[];
    quota?: QuotaSnapshot;
  }) {
    if (data.jobs) setJobs(data.jobs);
    if (data.individuals) setIndividuals(data.individuals);
    if (data.quota) setQuota(data.quota);
  }

  async function reload() {
    const res = await fetch("/api/jobs");
    const data = (await res.json()) as {
      jobs: ScoredJob[];
      individuals: ScoredIndividual[];
      quota: QuotaSnapshot;
    };
    applyPayload(data);
  }

  async function onJobStatus(id: string, status: JobStatus) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      flash("Status update failed");
      return;
    }
    applyPayload(await res.json());
    flash(`Status → ${status}`);
  }

  async function onJobDelete(id: string) {
    if (!window.confirm("Delete this vacancy?")) return;
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (!res.ok) {
      flash("Delete failed");
      return;
    }
    applyPayload(await res.json());
    flash("Deleted");
  }

  async function onIndStatus(id: string, status: IndividualStatus) {
    const res = await fetch(`/api/individuals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      flash("Status update failed");
      return;
    }
    applyPayload(await res.json());
    flash(`Individual → ${status}`);
  }

  async function onIndDelete(id: string) {
    if (!window.confirm("Delete this contact?")) return;
    const res = await fetch(`/api/individuals/${id}`, { method: "DELETE" });
    if (!res.ok) {
      flash("Delete failed");
      return;
    }
    applyPayload(await res.json());
    flash("Deleted");
  }

  async function onCopy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(`Copied · ${label}`);
    } catch {
      flash("Clipboard blocked");
    }
  }

  const queueJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          !j.scores.fit.antiFiltered &&
          ["new", "queued"].includes(j.status) &&
          j.scores.fit.band !== "hide",
      ),
    [jobs],
  );

  const queueIndividuals = useMemo(
    () =>
      individuals.filter(
        (i) =>
          ["new", "queued"].includes(i.status) &&
          i.scores.access.score >= 40,
      ),
    [individuals],
  );

  const visibleJobs = useMemo(() => {
    if (view === "europe") return jobs.filter((j) => j.region === "europe");
    if (view === "america") return jobs.filter((j) => j.region === "america");
    if (view === "applied") {
      return sortAppliedWithFollowUps(
        jobs.filter((j) =>
          ["applied", "follow_up", "replied", "interview", "offer"].includes(
            j.status,
          ),
        ),
      );
    }
    if (view === "queue") return queueJobs;
    return [];
  }, [jobs, view, queueJobs]);

  const euQueue = queueJobs.filter((j) => j.region === "europe").length;
  const usQueue = queueJobs.filter((j) => j.region === "america").length;

  return (
    <motion.div
      className="hd-shell"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <motion.header
        className="hd-top"
        initial={{ y: -24, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="hd-brand">
          APEX // <span>HIRE</span> <em>DESK</em>
        </div>
        <nav className="hd-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`${view === n.id ? "active" : ""} ${n.us && view === n.id ? "us" : ""}`}
              onClick={() => setView(n.id)}
            >
              {n.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              view === "individuals" ? setAddIndOpen(true) : setAddJobOpen(true)
            }
          >
            + Add
          </button>
        </nav>
        <div className="hd-quota">
          <div className="eu">
            EU <b>{quota.europe.used}</b>/{quota.europe.quota}
          </div>
          <div className="us">
            US <b>{quota.america.used}</b>/{quota.america.quota}
          </div>
          <div className="ind">
            IND <b>{quota.individuals.used}</b>/{quota.individuals.quota}
          </div>
        </div>
      </motion.header>

      <main className="hd-main">
        {view === "queue" && (
          <div className="hd-dual">
            <motion.div
              className="hd-rail eu"
              initial={{ opacity: 0, x: -28 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
            >
              <h2>Europe rail</h2>
              <p>
                {euQueue} jobs · quota left {quota.europe.remaining} (target
                8–12)
              </p>
            </motion.div>
            <motion.div
              className="hd-rail us"
              initial={{ opacity: 0, x: 28 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            >
              <h2>America rail</h2>
              <p>
                {usQueue} jobs · quota left {quota.america.remaining} (target
                8–12)
              </p>
            </motion.div>
          </div>
        )}

        {view === "queue" && queueIndividuals.length > 0 && (
          <div className="hd-rail" style={{ marginBottom: "0.85rem" }}>
            <h2>Individuals today</h2>
            <p>
              {queueIndividuals.length} ready · email quota left{" "}
              {quota.individuals.remaining}/{quota.individuals.quota}
            </p>
          </div>
        )}

        {view === "harvest" ? (
          <HarvestPanel onImported={() => void reload()} onFlash={flash} />
        ) : view === "templates" ? (
          <div className="tpl-list">
            {TEMPLATES.map((t) => (
              <div key={t.id} className="tpl-card">
                <h4>
                  {t.name}
                  {t.kind === "individual" ? " · direct" : ""}
                </h4>
                <pre>{t.body}</pre>
                <div
                  className="job-actions"
                  style={{ border: "none", paddingTop: "0.75rem" }}
                >
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onCopy(t.body, t.name)}
                  >
                    Copy skeleton
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : view === "individuals" || view === "queue" ? (
          <div className="hd-list">
            {view === "queue" &&
              queueJobs.map((job, i) => (
                <JobCard
                  key={job.id}
                  job={job}
                  index={i}
                  rank={i + 1}
                  onStatus={onJobStatus}
                  onCopy={onCopy}
                  onDelete={onJobDelete}
                />
              ))}
            {(view === "individuals" ? individuals : queueIndividuals).map(
              (ind, i) => (
                <IndividualCard
                  key={ind.id}
                  individual={ind}
                  index={i}
                  rank={view === "queue" ? i + 1 : undefined}
                  onStatus={onIndStatus}
                  onCopy={onCopy}
                  onDelete={onIndDelete}
                />
              ),
            )}
            {view === "individuals" && individuals.length === 0 && (
              <div className="empty">No individuals — add HR / senior email</div>
            )}
            {view === "queue" &&
              queueJobs.length === 0 &&
              queueIndividuals.length === 0 && (
                <div className="empty">Queue empty — harvest or add</div>
              )}
          </div>
        ) : visibleJobs.length === 0 ? (
          <div className="empty">No vacancies in this view</div>
        ) : (
          <div className="hd-list">
            {visibleJobs.map((job, i) => (
              <JobCard
                key={job.id}
                job={job}
                index={i}
                showFollowUp={view === "applied"}
                onStatus={onJobStatus}
                onCopy={onCopy}
                onDelete={onJobDelete}
              />
            ))}
          </div>
        )}
      </main>

      <AddJobModal
        open={addJobOpen}
        onClose={() => setAddJobOpen(false)}
        onCreated={() => {
          void reload();
          flash("Vacancy added");
        }}
      />
      <AddIndividualModal
        open={addIndOpen}
        onClose={() => setAddIndOpen(false)}
        onCreated={() => {
          void reload();
          flash("Individual added");
        }}
      />

      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
