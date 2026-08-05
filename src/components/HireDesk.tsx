"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AddIndividualModal } from "@/components/AddIndividualModal";
import { AddJobModal } from "@/components/AddJobModal";
import { AdminPanel } from "@/components/AdminPanel";
import { HarvestPanel } from "@/components/HarvestPanel";
import { HistoryPanel } from "@/components/HistoryPanel";
import {
  IndividualCardFace,
  IndividualPopup,
} from "@/components/IndividualPopup";
import { JobCardFace, JobPopup } from "@/components/JobPopup";
import type { HireActivity } from "@/lib/activity";
import { sortAppliedWithFollowUps } from "@/lib/followUp";
import { useI18n } from "@/lib/i18n";
import { TEMPLATES } from "@/lib/templates";
import type {
  AppView,
  IndividualStatus,
  JobStatus,
  QuotaSnapshot,
  Region,
  ScoredIndividual,
  ScoredJob,
} from "@/lib/types";

type Props = {
  initialJobs: ScoredJob[];
  initialIndividuals: ScoredIndividual[];
  initialQuota: QuotaSnapshot;
};

const NAV: Array<{ id: AppView; labelKey: string }> = [
  { id: "queue", labelKey: "nav.queue" },
  { id: "individuals", labelKey: "nav.individuals" },
  { id: "applied", labelKey: "nav.applied" },
  { id: "history", labelKey: "nav.history" },
  { id: "harvest", labelKey: "nav.harvest" },
  { id: "templates", labelKey: "nav.templates" },
  { id: "admin", labelKey: "nav.admin" },
];

const EASE = [0.16, 1, 0.3, 1] as const;

const RAILS: Array<{ id: Region; titleKey: string; cls: string }> = [
  { id: "europe", titleKey: "rail.europe", cls: "eu" },
  { id: "america", titleKey: "rail.america", cls: "us" },
  { id: "asia", titleKey: "rail.asia", cls: "asia" },
];

export function HireDesk({
  initialJobs,
  initialIndividuals,
  initialQuota,
}: Props) {
  const { t, locale, setLocale } = useI18n();
  const [view, setView] = useState<AppView>("queue");
  const [activeRail, setActiveRail] = useState<Region>("europe");
  const [jobs, setJobs] = useState(initialJobs);
  const [individuals, setIndividuals] = useState(initialIndividuals);
  const [quota, setQuota] = useState(initialQuota);
  const [activities, setActivities] = useState<HireActivity[]>([]);
  const [addJobOpen, setAddJobOpen] = useState(false);
  const [addIndOpen, setAddIndOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedIndId, setSelectedIndId] = useState<string | null>(null);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) || null,
    [jobs, selectedJobId],
  );
  const selectedInd = useMemo(
    () => individuals.find((i) => i.id === selectedIndId) || null,
    [individuals, selectedIndId],
  );

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

  const reloadActivities = useCallback(async () => {
    try {
      const res = await fetch("/api/activities", { cache: "no-store" });
      const data = (await res.json()) as { activities?: HireActivity[] };
      if (Array.isArray(data.activities)) setActivities(data.activities);
    } catch {
      /* ignore */
    }
  }, []);

  async function track(
    type: HireActivity["type"],
    entityId?: string | null,
    entityLabel?: string | null,
    detail?: string | null,
  ) {
    try {
      await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, entityId, entityLabel, detail }),
      });
      void reloadActivities();
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    void reloadActivities();
  }, [reloadActivities]);

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
      flash(t("toast.status_fail"));
      return;
    }
    const job = jobs.find((j) => j.id === id);
    applyPayload(await res.json());
    flash(t("toast.status", { status }));
    void track("status_change", id, job?.company || id, status);
  }

  async function onJobDelete(id: string) {
    if (!window.confirm(t("confirm.delete_job"))) return;
    const res = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    if (!res.ok) {
      flash(t("toast.delete_fail"));
      return;
    }
    applyPayload(await res.json());
    setSelectedJobId(null);
    flash(t("toast.deleted"));
  }

  async function onIndStatus(id: string, status: IndividualStatus) {
    const res = await fetch(`/api/individuals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      flash(t("toast.status_fail"));
      return;
    }
    const ind = individuals.find((i) => i.id === id);
    applyPayload(await res.json());
    flash(t("toast.ind_status", { status }));
    void track("status_change", id, ind?.name || id, status);
  }

  async function onIndDelete(id: string) {
    if (!window.confirm(t("confirm.delete_ind"))) return;
    const res = await fetch(`/api/individuals/${id}`, { method: "DELETE" });
    if (!res.ok) {
      flash(t("toast.delete_fail"));
      return;
    }
    applyPayload(await res.json());
    setSelectedIndId(null);
    flash(t("toast.deleted"));
  }

  async function onCopy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      flash(t("toast.copied", { label }));
      const type = label.toLowerCase().includes("brief")
        ? "copy_brief"
        : label.toLowerCase().includes("email") ||
            label.toLowerCase().includes("fu")
          ? "copy_email"
          : "copy_apply";
      void track(type, null, label, null);
    } catch {
      flash(t("toast.clipboard"));
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

  const railJobs = useMemo(
    () => queueJobs.filter((j) => j.region === activeRail),
    [queueJobs, activeRail],
  );

  const visibleJobs = useMemo(() => {
    if (view === "applied") {
      return sortAppliedWithFollowUps(
        jobs.filter((j) =>
          ["applied", "follow_up", "replied", "interview", "offer"].includes(
            j.status,
          ),
        ),
      );
    }
    if (view === "queue") return railJobs;
    return [];
  }, [jobs, view, railJobs]);

  const euQueue = queueJobs.filter((j) => j.region === "europe").length;
  const usQueue = queueJobs.filter((j) => j.region === "america").length;
  const asiaQueue = queueJobs.filter((j) => j.region === "asia").length;

  function railCount(id: Region) {
    if (id === "europe") return euQueue;
    if (id === "america") return usQueue;
    return asiaQueue;
  }

  function railQuotaLeft(id: Region) {
    if (id === "europe") return quota.europe.remaining;
    if (id === "america") return quota.america.remaining;
    return quota.asia.remaining;
  }

  function selectRail(id: Region) {
    setActiveRail(id);
    setView("queue");
  }

  function openJob(id: string) {
    setSelectedIndId(null);
    setSelectedJobId(id);
    const j = jobs.find((x) => x.id === id);
    void track("view", id, j ? `${j.company} · ${j.role}` : id, null);
  }

  function openInd(id: string) {
    setSelectedJobId(null);
    setSelectedIndId(id);
    const i = individuals.find((x) => x.id === id);
    void track("view", id, i?.name || id, "individual");
  }

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
        transition={{ duration: 0.55, ease: EASE }}
      >
        <div className="hd-brand">
          APEX // <span>HIRE</span> <em>DESK</em>
        </div>
        <nav className="hd-nav">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={view === n.id ? "active" : ""}
              onClick={() => setView(n.id)}
            >
              {view === n.id && (
                <motion.span
                  className="hd-nav-pill"
                  layoutId="hire-nav-pill"
                  transition={{ type: "spring", stiffness: 380, damping: 34 }}
                />
              )}
              <span className="hd-nav-label">{t(n.labelKey)}</span>
            </button>
          ))}
          <button
            type="button"
            onClick={() =>
              view === "individuals" ? setAddIndOpen(true) : setAddJobOpen(true)
            }
          >
            {t("nav.add")}
          </button>
        </nav>
        <div className="hd-top-tools">
          <div className="hd-lang" role="group" aria-label="Language">
            <button
              type="button"
              className={locale === "en" ? "active" : ""}
              onClick={() => setLocale("en")}
            >
              {t("lang.en")}
            </button>
            <button
              type="button"
              className={locale === "uk" ? "active" : ""}
              onClick={() => setLocale("uk")}
            >
              {t("lang.uk")}
            </button>
            <button
              type="button"
              className={locale === "ru" ? "active" : ""}
              onClick={() => setLocale("ru")}
            >
              {t("lang.ru")}
            </button>
          </div>
          <div className="hd-quota">
            <div className="eu">
              {t("quota.eu")} <b>{quota.europe.used}</b>/{quota.europe.quota}
            </div>
            <div className="us">
              {t("quota.us")} <b>{quota.america.used}</b>/{quota.america.quota}
            </div>
            <div className="asia">
              {t("quota.as")} <b>{quota.asia.used}</b>/{quota.asia.quota}
            </div>
            <div className="ind">
              {t("quota.ind")} <b>{quota.individuals.used}</b>/
              {quota.individuals.quota}
            </div>
          </div>
        </div>
      </motion.header>

      <main className={`hd-main${view === "harvest" ? " hd-main--harvest" : ""}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={view}
            initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: -10, filter: "blur(6px)" }}
            transition={{ duration: 0.32, ease: EASE }}
          >
            {view === "queue" && (
              <div className="hd-dual hd-rails">
                {RAILS.map((rail) => {
                  const active = activeRail === rail.id;
                  return (
                    <button
                      key={rail.id}
                      type="button"
                      className={`hd-rail ${rail.cls} hd-rail--btn${active ? " is-active" : ""}`}
                      onClick={() => selectRail(rail.id)}
                      aria-pressed={active}
                    >
                      <h2>{t(rail.titleKey)}</h2>
                      <p>
                        {t("rail.jobs_quota", {
                          jobs: railCount(rail.id),
                          left: railQuotaLeft(rail.id),
                        })}
                      </p>
                      <span className="hd-rail__hint">
                        {active ? t("rail.active") : t("rail.tap")}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {view === "harvest" ? (
              <HarvestPanel
                onImported={() => void reload()}
                onFlash={flash}
              />
            ) : view === "templates" ? (
              <div className="tpl-list">
                {TEMPLATES.map((tpl) => (
                  <div key={tpl.id} className="tpl-card">
                    <h4>
                      {tpl.name}
                      {tpl.kind === "individual" ? " · direct" : ""}
                    </h4>
                    <pre>{tpl.body}</pre>
                    <div
                      className="job-actions"
                      style={{ border: "none", paddingTop: "0.75rem" }}
                    >
                      <button
                        type="button"
                        className="primary"
                        onClick={() => onCopy(tpl.body, tpl.name)}
                      >
                        {t("templates.copy")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : view === "history" ? (
              <HistoryPanel
                activities={activities}
                jobs={jobs}
                individuals={individuals}
              />
            ) : view === "admin" ? (
              <AdminPanel
                jobs={jobs}
                individuals={individuals}
                quota={quota}
              />
            ) : view === "individuals" ? (
              <div className="hd-list">
                {individuals.map((ind, i) => (
                  <IndividualCardFace
                    key={ind.id}
                    individual={ind}
                    index={i}
                    onOpen={() => openInd(ind.id)}
                  />
                ))}
                {individuals.length === 0 && (
                  <div className="empty">{t("empty.individuals")}</div>
                )}
              </div>
            ) : view === "queue" ? (
              <div className="hd-list">
                {railJobs.map((job, i) => (
                  <JobCardFace
                    key={job.id}
                    job={job}
                    index={i}
                    rank={i + 1}
                    onOpen={() => openJob(job.id)}
                  />
                ))}
                {railJobs.length === 0 && (
                  <div className="empty">{t("empty.queue")}</div>
                )}
              </div>
            ) : visibleJobs.length === 0 ? (
              <div className="empty">{t("empty.applied")}</div>
            ) : (
              <div className="hd-list">
                {visibleJobs.map((job, i) => (
                  <JobCardFace
                    key={job.id}
                    job={job}
                    index={i}
                    showFollowUp={view === "applied"}
                    onOpen={() => openJob(job.id)}
                  />
                ))}
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <JobPopup
        job={selectedJob}
        open={!!selectedJob}
        onClose={() => setSelectedJobId(null)}
        onStatus={onJobStatus}
        onCopy={onCopy}
        onDelete={onJobDelete}
      />
      <IndividualPopup
        individual={selectedInd}
        open={!!selectedInd}
        onClose={() => setSelectedIndId(null)}
        onStatus={onIndStatus}
        onCopy={onCopy}
        onDelete={onIndDelete}
      />

      <AddJobModal
        open={addJobOpen}
        onClose={() => setAddJobOpen(false)}
        onCreated={() => {
          void reload();
          flash(t("toast.job_added"));
        }}
      />
      <AddIndividualModal
        open={addIndOpen}
        onClose={() => setAddIndOpen(false)}
        onCreated={() => {
          void reload();
          flash(t("toast.ind_added"));
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
