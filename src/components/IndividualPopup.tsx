"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import type { IndividualStatus, ScoredIndividual } from "@/lib/types";
import {
  renderIndividualEmail,
  renderIndividualTemplate,
} from "@/lib/templates";

type Props = {
  individual: ScoredIndividual | null;
  open: boolean;
  onClose: () => void;
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

export function IndividualPopup({
  individual: ind,
  open,
  onClose,
  onStatus,
  onCopy,
  onDelete,
}: Props) {
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && ind && (
        <motion.div
          className="hire-modal-root"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.button
            type="button"
            className="hire-modal-backdrop"
            aria-label="Close"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="hire-modal-panel"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 320, damping: 28 }}
          >
            <div className="hire-modal-top">
              <div>
                <div className="hire-modal-kicker">INDIVIDUAL · DIRECT</div>
                <h2 className="hire-modal-title">{ind.name}</h2>
                <div className="job-role" style={{ marginTop: "0.35rem" }}>
                  {KIND_LABEL[ind.kind]}
                  {ind.title ? ` · ${ind.title}` : ""} @ {ind.company}
                </div>
                <div className="job-meta" style={{ marginTop: "0.75rem" }}>
                  <span className={`job-chip ${ind.region === "europe" ? "eu" : "us"}`}>
                    {ind.region === "europe" ? "Europe" : "America"}
                  </span>
                  <span className="job-chip">{ind.status}</span>
                  {ind.targetRole && (
                    <span className="job-chip">{ind.targetRole}</span>
                  )}
                  <span className="job-chip">Access {ind.scores.access.score}</span>
                  <span className="job-chip">Lev {ind.scores.leverage.score}</span>
                  <span className="job-chip">Pri {ind.scores.priority.score}</span>
                </div>
              </div>
              <button type="button" className="hire-modal-x" onClick={onClose}>
                ✕
              </button>
            </div>

            {ind.notes && <p className="hire-modal-desc">{ind.notes}</p>}

            <div className="hire-modal-grid">
              <div>
                <div className="hire-modal-section">Contact</div>
                <p>
                  {ind.email ? (
                    <a href={`mailto:${ind.email}`}>{ind.email}</a>
                  ) : (
                    <span style={{ color: "var(--red)" }}>no email yet</span>
                  )}
                </p>
                {ind.linkedin && (
                  <p style={{ marginTop: "0.5rem" }}>
                    <a href={ind.linkedin} target="_blank" rel="noreferrer">
                      LinkedIn
                    </a>
                  </p>
                )}
              </div>
              <div>
                <div className="hire-modal-section">Actions</div>
                <div className="job-actions" style={{ border: "none", padding: 0 }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() =>
                      onCopy(renderIndividualEmail(ind), `Email · ${ind.name}`)
                    }
                  >
                    Copy email
                  </button>
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
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onStatus(ind.id, "emailed")}
                  >
                    Mark emailed
                  </button>
                  <button type="button" onClick={() => onStatus(ind.id, "queued")}>
                    Queue
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      onDelete(ind.id);
                      onClose();
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function IndividualCardFace({
  individual: ind,
  index = 0,
  rank,
  onOpen,
}: {
  individual: ScoredIndividual;
  index?: number;
  rank?: number;
  onOpen: () => void;
}) {
  const weakAccess = ind.scores.access.score < 40;
  return (
    <motion.article
      className={`job-card ${ind.region}${weakAccess ? " anti" : ""} job-card--click`}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index, 8) * 0.05, ease: EASE }}
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
          <div className="job-company">{ind.name}</div>
          <div className="job-role">
            {KIND_LABEL[ind.kind]}
            {ind.title ? ` · ${ind.title}` : ""} @ {ind.company}
          </div>
        </div>
        <div className="job-meta">
          <span className={`job-chip ${ind.region === "europe" ? "eu" : "us"}`}>
            {ind.region === "europe" ? "Europe" : "America"}
          </span>
          <span className="job-chip">{ind.status}</span>
          {rank != null && <span className="job-chip">I#{rank}</span>}
          <span className="job-chip">
            {ind.email ? "has email" : "no email"}
          </span>
          {ind.targetRole && <span className="job-chip">{ind.targetRole}</span>}
        </div>
      </div>
      <div className="job-scores">
        <div className="score-pill">
          Acc <strong>{ind.scores.access.score}</strong>
        </div>
        <div className="score-pill">
          Lev <strong>{ind.scores.leverage.score}</strong>
        </div>
        <div className="score-pill gold">
          Pri <strong>{ind.scores.priority.score}</strong>
        </div>
      </div>
    </motion.article>
  );
}
