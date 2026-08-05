"use client";

import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import type { IndividualStatus, ScoredIndividual } from "@/lib/types";
import {
  renderIndividualEmail,
  renderIndividualTemplate,
} from "@/lib/templates";
import { useTranslatedFields } from "@/hooks/useTranslatedText";
import { useI18n } from "@/lib/i18n";
import { regionClass } from "@/lib/regions";

type Props = {
  individual: ScoredIndividual | null;
  open: boolean;
  onClose: () => void;
  onStatus: (id: string, status: IndividualStatus) => void;
  onCopy: (text: string, label: string) => void;
  onDelete: (id: string) => void;
};

const EASE = [0.16, 1, 0.3, 1] as const;

export function IndividualPopup({
  individual: ind,
  open,
  onClose,
  onStatus,
  onCopy,
  onDelete,
}: Props) {
  const { t, trRegion, trStatus, trKind } = useI18n();
  const { values: tr } = useTranslatedFields(
    {
      title: ind?.title || "",
      notes: ind?.notes || "",
      targetRole: ind?.targetRole || "",
    },
    { enabled: open && !!ind },
  );

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
            aria-label={t("popup.close")}
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
                <div className="hire-modal-kicker">{t("ind.dossier")}</div>
                <h2 className="hire-modal-title">{ind.name}</h2>
                <div className="job-role" style={{ marginTop: "0.35rem" }}>
                  {trKind(ind.kind)}
                  {(tr.title || ind.title) ? ` · ${tr.title || ind.title}` : ""} @{" "}
                  {ind.company}
                </div>
                <div className="job-meta" style={{ marginTop: "0.75rem" }}>
                  <span className={`job-chip ${regionClass(ind.region)}`}>
                    {trRegion(ind.region)}
                  </span>
                  <span className="job-chip">{trStatus(ind.status)}</span>
                  {(tr.targetRole || ind.targetRole) && (
                    <span className="job-chip">
                      {tr.targetRole || ind.targetRole}
                    </span>
                  )}
                  <span className="job-chip">
                    {t("score.access")} {ind.scores.access.score}
                  </span>
                  <span className="job-chip">
                    {t("score.leverage")} {ind.scores.leverage.score}
                  </span>
                  <span className="job-chip">
                    {t("score.pri")} {ind.scores.priority.score}
                  </span>
                </div>
              </div>
              <button type="button" className="hire-modal-x" onClick={onClose}>
                ✕
              </button>
            </div>

            {(tr.notes || ind.notes) && (
              <p className="hire-modal-desc">{tr.notes || ind.notes}</p>
            )}

            <div className="hire-modal-grid">
              <div>
                <div className="hire-modal-section">{t("ind.contact")}</div>
                <p>
                  {ind.email ? (
                    <a href={`mailto:${ind.email}`}>{ind.email}</a>
                  ) : (
                    <span style={{ color: "var(--red)" }}>
                      {t("ind.no_email")}
                    </span>
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
                <div className="hire-modal-section">{t("ind.actions")}</div>
                <div className="job-actions" style={{ border: "none", padding: 0 }}>
                  <button
                    type="button"
                    className="primary"
                    onClick={() =>
                      onCopy(renderIndividualEmail(ind), `Email · ${ind.name}`)
                    }
                  >
                    {t("ind.copy_email")}
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
                    {t("ind.copy_fu")}
                  </button>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onStatus(ind.id, "emailed")}
                  >
                    {t("ind.mark_emailed")}
                  </button>
                  <button type="button" onClick={() => onStatus(ind.id, "queued")}>
                    {t("popup.queue")}
                  </button>
                  <button
                    type="button"
                    className="danger"
                    onClick={() => {
                      onDelete(ind.id);
                      onClose();
                    }}
                  >
                    {t("popup.delete")}
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
  const { t, trRegion, trStatus, trKind } = useI18n();
  const { values: tr } = useTranslatedFields({
    title: ind.title || "",
    targetRole: ind.targetRole || "",
  });
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
            {trKind(ind.kind)}
            {(tr.title || ind.title) ? ` · ${tr.title || ind.title}` : ""} @{" "}
            {ind.company}
          </div>
        </div>
        <div className="job-meta">
          <span className={`job-chip ${regionClass(ind.region)}`}>
            {trRegion(ind.region)}
          </span>
          <span className="job-chip">{trStatus(ind.status)}</span>
          {rank != null && <span className="job-chip">I#{rank}</span>}
          <span className="job-chip">
            {ind.email ? t("ind.has_email") : t("ind.no_email")}
          </span>
          {(tr.targetRole || ind.targetRole) && (
            <span className="job-chip">{tr.targetRole || ind.targetRole}</span>
          )}
        </div>
      </div>
      <div className="job-scores">
        <div className="score-pill">
          {t("score.access")} <strong>{ind.scores.access.score}</strong>
        </div>
        <div className="score-pill">
          {t("score.leverage")} <strong>{ind.scores.leverage.score}</strong>
        </div>
        <div className="score-pill gold">
          {t("score.pri")} <strong>{ind.scores.priority.score}</strong>
        </div>
      </div>
    </motion.article>
  );
}
