"use client";

import { motion } from "framer-motion";
import {
  followUpTemplateForJob,
  getFollowUpInfo,
} from "@/lib/followUp";
import { useTranslatedFields } from "@/hooks/useTranslatedText";
import { useI18n } from "@/lib/i18n";
import type { JobStatus, ScoredJob } from "@/lib/types";
import { renderApply, renderTemplate } from "@/lib/templates";
import { previewText } from "@/lib/text";
import { jobIntakeAt, regionClass } from "@/lib/regions";

type Props = {
  job: ScoredJob;
  rank?: number;
  index?: number;
  showFollowUp?: boolean;
  onStatus: (id: string, status: JobStatus) => void;
  onCopy: (text: string, label: string) => void;
  onDelete: (id: string) => void;
};

const EASE = [0.16, 1, 0.3, 1] as const;

export function JobCard({
  job,
  rank,
  index = 0,
  showFollowUp = false,
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
  const { values: tr, loading } = useTranslatedFields({
    role: job.role,
    description: previewText(job.description, 220),
    location: job.location || "",
    anti: job.scores.fit.antiFilterReason || "",
  });
  const anti = job.scores.fit.antiFiltered;
  const rClass = regionClass(job.region);
  const age = trAge(jobIntakeAt(job));
  const sched = trSchedule(job);
  const fu = showFollowUp ? getFollowUpInfo(job) : null;
  const fuTemplate = showFollowUp ? followUpTemplateForJob(job) : null;

  return (
    <motion.article
      className={`job-card ${job.region}${anti ? " anti" : ""}${fu?.due ? " follow-due" : ""}`}
      initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{
        duration: 0.45,
        delay: Math.min(index, 8) * 0.05,
        ease: EASE,
      }}
      whileHover={{ y: -2 }}
    >
      <div>
        <div className="job-head">
          <div className="job-company">{job.company}</div>
          <div className="job-role">
            {tr.role || job.role}
            {loading ? (
              <span
                className="job-chip"
                style={{ marginLeft: "0.45rem", opacity: 0.65 }}
              >
                {t("popup.translating")}
              </span>
            ) : null}
          </div>
        </div>
        <div className="job-meta">
          <span className={`job-chip ${rClass}`}>
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
        {job.proofProjects && job.proofProjects.length > 0 && (
          <div className="job-proof">
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
        {anti && (tr.anti || job.scores.fit.antiFilterReason) && (
          <div className="job-proof" style={{ color: "var(--red)" }}>
            {tr.anti || job.scores.fit.antiFilterReason}
          </div>
        )}
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

      <div className="job-actions">
        {job.url && (
          <a className="btn" href={job.url} target="_blank" rel="noreferrer">
            {t("popup.open")}
          </a>
        )}
        {!anti && (
          <button
            type="button"
            className="primary"
            onClick={() => onCopy(renderApply(job), `Apply · ${job.company}`)}
          >
            {t("popup.copy_apply")}
          </button>
        )}
        {fuTemplate && (
          <button
            type="button"
            className="primary"
            onClick={() =>
              onCopy(
                renderTemplate(fuTemplate, job),
                `Follow-up D${fu?.stage} · ${job.company}`,
              )
            }
          >
            Copy FU D{fu?.stage}
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
        {job.status !== "queued" && job.status !== "applied" && !anti && (
          <button type="button" onClick={() => onStatus(job.id, "queued")}>
            {t("popup.queue")}
          </button>
        )}
        {job.status !== "applied" &&
          job.status !== "follow_up" &&
          !anti && (
            <button
              type="button"
              className="primary"
              onClick={() => onStatus(job.id, "applied")}
            >
              {t("popup.applied")}
            </button>
          )}
        {(job.status === "applied" || job.status === "follow_up") && (
          <button type="button" onClick={() => onStatus(job.id, "follow_up")}>
            {t("status.follow_up")}
          </button>
        )}
        {(job.status === "applied" || job.status === "follow_up") && (
          <button type="button" onClick={() => onStatus(job.id, "interview")}>
            {t("status.interview")}
          </button>
        )}
        <button type="button" onClick={() => onStatus(job.id, "rejected")}>
          {t("popup.reject")}
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => onDelete(job.id)}
        >
          {t("popup.delete")}
        </button>
      </div>
    </motion.article>
  );
}
