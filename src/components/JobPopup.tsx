"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import {
  followUpTemplateForJob,
  getFollowUpInfo,
} from "@/lib/followUp";
import { useTranslatedFields } from "@/hooks/useTranslatedText";
import { useI18n } from "@/lib/i18n";
import { jobPostedAt, regionClass } from "@/lib/regions";
import type { JobStatus, ScoredJob } from "@/lib/types";
import { renderApply, renderTemplate } from "@/lib/templates";
import { previewText, stripHtml } from "@/lib/text";

type Props = {
  job: ScoredJob | null;
  open: boolean;
  onClose: () => void;
  onStatus: (id: string, status: JobStatus) => void;
  onCopy: (text: string, label: string) => void;
  onDelete: (id: string) => void;
};

const EASE = [0.16, 1, 0.3, 1] as const;

export function JobPopup({
  job,
  open,
  onClose,
  onStatus,
  onCopy,
  onDelete,
}: Props) {
  const {
    t,
    trRegion,
    trStatus,
    trAge,
    trSalary,
    trSchedule,
  } = useI18n();
  const { values: tr, loading } = useTranslatedFields(
    {
      role: job?.role || "",
      description: job?.description || "",
      location: job?.location || "",
      anti: job?.scores.fit.antiFilterReason || "",
    },
    { enabled: open && !!job },
  );

  if (typeof document === "undefined") return null;

  const fu = job ? getFollowUpInfo(job) : null;
  const fuTemplate = job ? followUpTemplateForJob(job) : null;
  const anti = job?.scores.fit.antiFiltered;
  const sched = job ? trSchedule(job) : [];
  const age = job ? trAge(jobPostedAt(job)) : null;

  return createPortal(
    <AnimatePresence>
      {open && job && (
        <motion.div
          className="hire-modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: EASE }}
        >
          <motion.button
            type="button"
            className="hire-modal-backdrop"
            aria-label={t("popup.close")}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="hire-modal-panel"
            initial={{ opacity: 0, scale: 0.96, filter: "blur(10px)" }}
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.98, filter: "blur(6px)" }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            <div className="hire-modal-top">
              <div>
                <div className="hire-modal-kicker">{t("dossier.kicker")}</div>
                <h2 className="hire-modal-title">{job.company}</h2>
                <div className="job-role" style={{ marginTop: "0.35rem" }}>
                  {tr.role || job.role}
                  {loading ? (
                    <span
                      className="job-chip"
                      style={{ marginLeft: "0.5rem", opacity: 0.7 }}
                    >
                      {t("popup.translating")}
                    </span>
                  ) : null}
                </div>
                <div className="job-meta" style={{ marginTop: "0.75rem" }}>
                  <span className={`job-chip ${regionClass(job.region)}`}>
                    {trRegion(job.region)}
                  </span>
                  <span className="job-chip">{trStatus(job.status)}</span>
                  {age && (
                    <span
                      className="job-chip"
                      style={{
                        color: age.stale ? "var(--red)" : "var(--cyan)",
                      }}
                      title={jobPostedAt(job)}
                    >
                      {age.label}
                    </span>
                  )}
                  <span className="job-chip">{trSalary(job.salary)}</span>
                  {sched.map((s) => (
                    <span key={s} className="job-chip">
                      {s}
                    </span>
                  ))}
                  {(tr.location || job.location) && (
                    <span className="job-chip">
                      {tr.location || job.location}
                    </span>
                  )}
                  <span className="job-chip">
                    {t("score.fit")} {job.scores.fit.score}
                  </span>
                  <span className="job-chip">
                    {t("score.reach")} {job.scores.reach.score}
                  </span>
                  <span className="job-chip">
                    {t("score.pri")} {job.scores.priority.score}
                  </span>
                </div>
              </div>
              <button type="button" className="hire-modal-x" onClick={onClose}>
                ✕
              </button>
            </div>

            <p className="hire-modal-desc">
              {stripHtml(tr.description || job.description)}
            </p>

            {job.proofProjects && job.proofProjects.length > 0 && (
              <div className="job-proof" style={{ marginTop: "1rem" }}>
                {t("dossier.proof")}:{" "}
                {job.proofProjects.map((p, i) => (
                  <span key={p.projectId}>
                    {i > 0 ? " · " : ""}
                    {p.demoUrl ? (
                      <a href={p.demoUrl} target="_blank" rel="noreferrer">
                        {p.name}
                      </a>
                    ) : (
                      p.name
                    )}
                  </span>
                ))}
              </div>
            )}

            {anti && (
              <div className="job-proof" style={{ color: "var(--red)" }}>
                {t("dossier.anti")}:{" "}
                {tr.anti || job.scores.fit.antiFilterReason}
              </div>
            )}

            <div
              className="job-actions"
              style={{ marginTop: "1.25rem", border: "none" }}
            >
              {job.url && (
                <a
                  className="btn"
                  href={job.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t("popup.open")}
                </a>
              )}
              {!anti && (
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    onCopy(renderApply(job), `Apply · ${job.company}`)
                  }
                >
                  {t("popup.copy_apply")}
                </button>
              )}
              {!anti && (
                <button
                  type="button"
                  onClick={() =>
                    onCopy(
                      renderTemplate("interview_brief", job),
                      `Brief · ${job.company}`,
                    )
                  }
                >
                  {t("popup.copy_brief")}
                </button>
              )}
              {fuTemplate && (
                <button
                  type="button"
                  className="primary"
                  onClick={() =>
                    onCopy(
                      renderTemplate(fuTemplate, job),
                      `Follow-up · ${job.company}`,
                    )
                  }
                >
                  Copy FU {fu?.label}
                </button>
              )}
              <button type="button" onClick={() => onStatus(job.id, "queued")}>
                {t("popup.queue")}
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => onStatus(job.id, "applied")}
              >
                {t("popup.applied")}
              </button>
              <button
                type="button"
                onClick={() => onStatus(job.id, "rejected")}
              >
                {t("popup.reject")}
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  onDelete(job.id);
                  onClose();
                }}
              >
                {t("popup.delete")}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Compact list card — click opens popup */
export function JobCardFace({
  job,
  rank,
  index = 0,
  showFollowUp,
  onOpen,
}: {
  job: ScoredJob;
  rank?: number;
  index?: number;
  showFollowUp?: boolean;
  onOpen: () => void;
}) {
  const {
    t,
    trRegion,
    trStatus,
    trAge,
    trSalary,
    trSchedule,
  } = useI18n();
  const { values: tr } = useTranslatedFields({
    role: job.role,
    description: previewText(job.description, 220),
    location: job.location || "",
  });
  const anti = job.scores.fit.antiFiltered;
  const fu = showFollowUp ? getFollowUpInfo(job) : null;
  const sched = trSchedule(job);
  const age = trAge(jobPostedAt(job));

  return (
    <motion.article
      className={`job-card ${job.region}${anti ? " anti" : ""}${fu?.due ? " follow-due" : ""} job-card--click`}
      initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{
        duration: 0.45,
        delay: Math.min(index, 8) * 0.05,
        ease: EASE,
      }}
      whileHover={{ y: -2 }}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div>
        <div className="job-head">
          <div className="job-company">{job.company}</div>
          <div className="job-role">{tr.role || job.role}</div>
        </div>
        <div className="job-meta">
          <span className={`job-chip ${regionClass(job.region)}`}>
            {trRegion(job.region)}
          </span>
          <span className="job-chip">{trStatus(job.status)}</span>
          {rank != null && <span className="job-chip">Q#{rank}</span>}
          <span
            className="job-chip"
            style={{ color: age.stale ? "var(--red)" : undefined }}
          >
            {age.label}
          </span>
          <span className="job-chip">{trSalary(job.salary)}</span>
          {sched.map((s) => (
            <span key={s} className="job-chip">
              {s}
            </span>
          ))}
          {(tr.location || job.location) && (
            <span className="job-chip">{tr.location || job.location}</span>
          )}
          {fu?.due && (
            <span className="job-chip" style={{ color: "var(--gold)" }}>
              {fu.label}
            </span>
          )}
          {anti && (
            <span className="job-chip" style={{ color: "var(--red)" }}>
              {t("dossier.anti")}
            </span>
          )}
        </div>
        <p className="job-desc">
          {tr.description || previewText(job.description)}
        </p>
      </div>
      <div className="job-scores">
        <div className="score-pill">
          {t("score.fit")} <strong>{job.scores.fit.score}</strong>
        </div>
        <div className="score-pill">
          {t("score.reach")} <strong>{job.scores.reach.score}</strong>
        </div>
        <div className="score-pill gold">
          {t("score.pri")} <strong>{job.scores.priority.score}</strong>
        </div>
      </div>
    </motion.article>
  );
}
