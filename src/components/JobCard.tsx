"use client";

import { motion } from "framer-motion";
import {
  followUpTemplateForJob,
  getFollowUpInfo,
} from "@/lib/followUp";
import type { JobStatus, ScoredJob } from "@/lib/types";
import { renderApply, renderTemplate } from "@/lib/templates";
import { salaryLabel } from "@/lib/text";
import {
  jobPostedAt,
  postAgeLabel,
  regionClass,
  regionLabel,
} from "@/lib/regions";

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
  const anti = job.scores.fit.antiFiltered;
  const rClass = regionClass(job.region);
  const age = postAgeLabel(jobPostedAt(job));
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
          <div className="job-role">{job.role}</div>
        </div>
        <div className="job-meta">
          <span className={`job-chip ${rClass}`}>
            {regionLabel(job.region)}
          </span>
          <span className="job-chip">{job.status}</span>
          {rank != null && <span className="job-chip">Q#{rank}</span>}
          <span
            className="job-chip"
            style={{ color: age.stale ? "var(--red)" : undefined }}
          >
            {age.label}
          </span>
          <span className="job-chip">{salaryLabel(job.salary)}</span>
          {job.location && <span className="job-chip">{job.location}</span>}
          {job.scores.fit.band !== "hide" && (
            <span className="job-chip">{job.scores.fit.band}</span>
          )}
          {fu?.due && (
            <span className="job-chip" style={{ color: "var(--gold)" }}>
              {fu.label}
            </span>
          )}
          {anti && (
            <span className="job-chip" style={{ color: "var(--red)" }}>
              anti-filter
            </span>
          )}
        </div>
        <p className="job-desc">
          {job.description.length > 220
            ? job.description.slice(0, 220) + "…"
            : job.description}
        </p>
        {job.proofProjects && job.proofProjects.length > 0 && (
          <div className="job-proof">
            Proof:{" "}
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
        {anti && job.scores.fit.antiFilterReason && (
          <div className="job-proof" style={{ color: "var(--red)" }}>
            {job.scores.fit.antiFilterReason}
          </div>
        )}
      </div>

      <div className="job-scores">
        <div className="score-pill">
          Fit <strong>{job.scores.fit.score}</strong>
        </div>
        <div className="score-pill">
          Reach <strong>{job.scores.reach.score}</strong>
        </div>
        <div className="score-pill gold">
          Pri <strong>{job.scores.priority.score}</strong>
        </div>
      </div>

      <div className="job-actions">
        {job.url && (
          <a className="btn" href={job.url} target="_blank" rel="noreferrer">
            Open link
          </a>
        )}
        {!anti && (
          <button
            type="button"
            className="primary"
            onClick={() => onCopy(renderApply(job), `Apply · ${job.company}`)}
          >
            Copy apply
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
            Copy brief
          </button>
        )}
        {job.status !== "queued" && job.status !== "applied" && !anti && (
          <button type="button" onClick={() => onStatus(job.id, "queued")}>
            Queue
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
              Mark applied
            </button>
          )}
        {(job.status === "applied" || job.status === "follow_up") && (
          <button type="button" onClick={() => onStatus(job.id, "follow_up")}>
            Log follow-up
          </button>
        )}
        {(job.status === "applied" || job.status === "follow_up") && (
          <button type="button" onClick={() => onStatus(job.id, "interview")}>
            Interview
          </button>
        )}
        <button type="button" onClick={() => onStatus(job.id, "rejected")}>
          Reject
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => onDelete(job.id)}
        >
          Delete
        </button>
      </div>
    </motion.article>
  );
}
