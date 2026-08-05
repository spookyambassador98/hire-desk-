"use client";

import { motion } from "framer-motion";
import type { IndividualStatus, ScoredIndividual } from "@/lib/types";
import {
  renderIndividualEmail,
  renderIndividualTemplate,
} from "@/lib/templates";
import { useI18n } from "@/lib/i18n";
import { regionClass } from "@/lib/regions";

type Props = {
  individual: ScoredIndividual;
  index?: number;
  rank?: number;
  onStatus: (id: string, status: IndividualStatus) => void;
  onCopy: (text: string, label: string) => void;
  onDelete: (id: string) => void;
};

const EASE = [0.16, 1, 0.3, 1] as const;

export function IndividualCard({
  individual: ind,
  index = 0,
  rank,
  onStatus,
  onCopy,
  onDelete,
}: Props) {
  const { t, trRegion, trStatus, trKind } = useI18n();
  const rClass = regionClass(ind.region);
  const weakAccess = ind.scores.access.score < 40;

  return (
    <motion.article
      className={`job-card ${ind.region}${weakAccess ? " anti" : ""}`}
      initial={{ opacity: 0, y: 18, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{
        duration: 0.45,
        delay: Math.min(index, 8) * 0.05,
        ease: EASE,
      }}
    >
      <div>
        <div className="job-head">
          <div className="job-company">{ind.name}</div>
          <div className="job-role">
            {trKind(ind.kind)}
            {ind.title ? ` · ${ind.title}` : ""} @ {ind.company}
          </div>
        </div>
        <div className="job-meta">
          <span className={`job-chip ${rClass}`}>{trRegion(ind.region)}</span>
          <span className="job-chip">{trStatus(ind.status)}</span>
          {rank != null && <span className="job-chip">I#{rank}</span>}
          <span className="job-chip">
            {ind.email ? t("ind.has_email") : t("ind.no_email")}
          </span>
          {ind.targetRole && (
            <span className="job-chip">{ind.targetRole}</span>
          )}
        </div>
        {ind.proofProjects && ind.proofProjects.length > 0 && (
          <div className="job-proof">
            {t("dossier.proof")}:{" "}
            {ind.proofProjects.map((p) => p.name).join(" · ")}
          </div>
        )}
      </div>

      <div className="job-scores">
        <div className="score-pill">
          {t("score.access")} <strong>{ind.scores.access.score}</strong>
        </div>
        <div className="score-pill">
          {t("score.leverage")} <strong>{ind.scores.leverage.score}</strong>
        </div>
        <div className="score-pill gold">
          {t("score.fit")} <strong>{ind.scores.roleFit.score}</strong>
        </div>
      </div>

      <div className="job-actions">
        {ind.email && (
          <a className="btn" href={`mailto:${ind.email}`}>
            {t("popup.open")}
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
            {t("ind.copy_email")}
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
            {t("ind.copy_fu")}
          </button>
        )}
        {ind.status !== "emailed" && !weakAccess && (
          <button
            type="button"
            className="primary"
            onClick={() => onStatus(ind.id, "emailed")}
          >
            {t("ind.mark_emailed")}
          </button>
        )}
        {ind.status !== "queued" && (
          <button type="button" onClick={() => onStatus(ind.id, "queued")}>
            {t("popup.queue")}
          </button>
        )}
        <button
          type="button"
          className="danger"
          onClick={() => onDelete(ind.id)}
        >
          {t("popup.delete")}
        </button>
      </div>
    </motion.article>
  );
}
