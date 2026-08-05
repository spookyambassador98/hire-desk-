"use client";

import { motion } from "framer-motion";
import type { IndividualStatus, ScoredIndividual } from "@/lib/types";
import {
  renderIndividualEmail,
  renderIndividualTemplate,
} from "@/lib/templates";
import { regionClass, regionLabel } from "@/lib/regions";

type Props = {
  individual: ScoredIndividual;
  index?: number;
  rank?: number;
  onStatus: (id: string, status: IndividualStatus) => void;
  onCopy: (text: string, label: string) => void;
  onDelete: (id: string) => void;
};

const EASE = [0.16, 1, 0.3, 1] as const;

const KIND_LABEL: Record<ScoredIndividual["kind"], string> = {
  hr: "HR",
  hiring_manager: "Hiring Manager",
  senior_eng: "Senior Eng",
  founder: "Founder",
  recruiter: "Recruiter",
  other: "Other",
};

export function IndividualCard({
  individual: ind,
  index = 0,
  rank,
  onStatus,
  onCopy,
  onDelete,
}: Props) {
  const rClass = regionClass(ind.region);
  const weakAccess = ind.scores.access.score < 40;

  return (
    <motion.article
      className={`job-card ${ind.region}${weakAccess ? " anti" : ""}`}
      initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.45, delay: Math.min(index, 8) * 0.05, ease: EASE }}
    >
      <div>
        <div className="job-head">
          <div className="job-company">{ind.name}</div>
          <div className="job-role">
            {KIND_LABEL[ind.kind]}
            {ind.title ? ` · ${ind.title}` : ""} @ {ind.company}
          </div>
        </div>
        <div className="job-meta">
          <span className={`job-chip ${rClass}`}>
            {regionLabel(ind.region)}
          </span>
          <span className="job-chip">{ind.status}</span>
          {rank != null && <span className="job-chip">I#{rank}</span>}
          <span className="job-chip">direct</span>
          {ind.targetRole && (
            <span className="job-chip">{ind.targetRole}</span>
          )}
        </div>
        {ind.notes && <p className="job-desc">{ind.notes}</p>}
        <div className="job-proof">
          {ind.email ? (
            <a href={`mailto:${ind.email}`}>{ind.email}</a>
          ) : (
            <span style={{ color: "var(--red)" }}>no email</span>
          )}
          {ind.linkedin && (
            <>
              {" · "}
              <a href={ind.linkedin} target="_blank" rel="noreferrer">
                LinkedIn
              </a>
            </>
          )}
        </div>
        {ind.proofProjects && ind.proofProjects.length > 0 && (
          <div className="job-proof">
            Proof: {ind.proofProjects.map((p) => p.name).join(" · ")}
          </div>
        )}
      </div>

      <div className="job-scores">
        <div className="score-pill">
          Access <strong>{ind.scores.access.score}</strong>
        </div>
        <div className="score-pill">
          Leverage <strong>{ind.scores.leverage.score}</strong>
        </div>
        <div className="score-pill gold">
          Fit <strong>{ind.scores.roleFit.score}</strong>
        </div>
      </div>

      <div className="job-actions">
        {ind.email && (
          <a className="btn" href={`mailto:${ind.email}`}>
            Open mail
          </a>
        )}
        {!weakAccess && (
          <button
            type="button"
            className="primary"
            onClick={() =>
              onCopy(renderIndividualEmail(ind), `Email · ${ind.name}`)
            }
          >
            Copy email
          </button>
        )}
        {ind.status === "emailed" && (
          <button
            type="button"
            onClick={() =>
              onCopy(
                renderIndividualTemplate("ind_followup", ind),
                `FU · ${ind.name}`,
              )
            }
          >
            Copy follow-up
          </button>
        )}
        {ind.status !== "queued" && ind.status !== "emailed" && (
          <button type="button" onClick={() => onStatus(ind.id, "queued")}>
            Queue
          </button>
        )}
        {ind.status !== "emailed" && !weakAccess && (
          <button
            type="button"
            className="primary"
            onClick={() => onStatus(ind.id, "emailed")}
          >
            Mark emailed
          </button>
        )}
        {(ind.status === "emailed" || ind.status === "replied") && (
          <button type="button" onClick={() => onStatus(ind.id, "replied")}>
            Replied
          </button>
        )}
        {ind.status === "replied" && (
          <button type="button" onClick={() => onStatus(ind.id, "intro")}>
            Intro
          </button>
        )}
        <button type="button" onClick={() => onStatus(ind.id, "closed")}>
          Close
        </button>
        <button
          type="button"
          className="danger"
          onClick={() => onDelete(ind.id)}
        >
          Delete
        </button>
      </div>
    </motion.article>
  );
}
