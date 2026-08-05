import { matchPortfolio } from "./portfolio";
import type {
  Individual,
  IndividualScores,
  PriorityContext,
  ScoreBreakdownItem,
} from "./types";

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Access 0–100 — can you actually email them? */
export function computeAccess(ind: Individual): {
  score: number;
  breakdown: ScoreBreakdownItem[];
} {
  const breakdown: ScoreBreakdownItem[] = [];
  let score = 0;
  const email = ind.email?.trim();
  const li = ind.linkedin?.trim();

  if (email) {
    score += 55;
    breakdown.push({
      key: "email",
      label: "Email",
      points: 55,
      max: 55,
      note: email,
    });
  } else {
    breakdown.push({
      key: "email",
      label: "Email",
      points: 0,
      max: 55,
      note: "missing",
    });
  }

  if (li) {
    score += 25;
    breakdown.push({
      key: "linkedin",
      label: "LinkedIn",
      points: 25,
      max: 25,
    });
  } else {
    breakdown.push({
      key: "linkedin",
      label: "LinkedIn",
      points: 0,
      max: 25,
      note: "missing",
    });
  }

  if (email && li) {
    score += 20;
    breakdown.push({
      key: "combo",
      label: "Email + LinkedIn",
      points: 20,
      max: 20,
    });
  }

  return { score: clamp(score, 0, 100), breakdown };
}

/** Leverage 0–100 — how useful is this person in the hiring path */
export function computeLeverage(ind: Individual): {
  score: number;
  breakdown: ScoreBreakdownItem[];
} {
  const table: Record<Individual["kind"], { pts: number; note: string }> = {
    founder: { pts: 95, note: "Founder / decision maker" },
    hiring_manager: { pts: 88, note: "Hiring manager" },
    senior_eng: { pts: 72, note: "Senior eng — referral / warm intro" },
    hr: { pts: 65, note: "HR / people ops" },
    recruiter: { pts: 58, note: "Recruiter" },
    other: { pts: 40, note: "Other contact" },
  };
  const row = table[ind.kind];
  return {
    score: row.pts,
    breakdown: [
      {
        key: "kind",
        label: "Role leverage",
        points: row.pts,
        max: 100,
        note: row.note,
      },
    ],
  };
}

/** Role fit via portfolio matcher on target role + company */
export function computeIndividualRoleFit(ind: Individual): {
  score: number;
  breakdown: ScoreBreakdownItem[];
  proofs: ReturnType<typeof matchPortfolio>["proofs"];
  whyFit: string;
} {
  const pseudo = {
    role: ind.targetRole || ind.title || ind.kind,
    company: ind.company,
    description: `${ind.targetRole || ""} ${ind.title || ""} ${ind.notes || ""}`,
  };
  const { proofs, whyFit } = matchPortfolio(pseudo);
  const pts =
    proofs.length >= 2 ? 85 : proofs.length === 1 ? 65 : ind.targetRole ? 40 : 25;
  return {
    score: pts,
    proofs,
    whyFit,
    breakdown: [
      {
        key: "proof",
        label: "Portfolio angle",
        points: pts,
        max: 100,
        note: proofs.map((p) => p.name).join(" + ") || "generic sticky",
      },
    ],
  };
}

export function enrichIndividual(ind: Individual): Individual {
  if (ind.proofProjects?.length && ind.whyFit) return ind;
  const { proofs, whyFit } = computeIndividualRoleFit(ind);
  return { ...ind, proofProjects: proofs, whyFit };
}

export function scoreIndividual(
  ind: Individual,
  ctx: PriorityContext & { individualQuotaRemaining?: number },
): IndividualScores {
  const enriched = enrichIndividual(ind);
  const access = computeAccess(enriched);
  const leverage = computeLeverage(enriched);
  const role = computeIndividualRoleFit(enriched);

  let statusPenalty = 0;
  switch (enriched.status) {
    case "new":
    case "queued":
      statusPenalty = 0;
      break;
    case "emailed":
      statusPenalty = 18;
      break;
    case "replied":
    case "intro":
      statusPenalty = 5;
      break;
    case "closed":
      statusPenalty = 50;
      break;
  }

  // No email → bury in priority even if leverage is high
  const accessGate = access.score < 40 ? 25 : 0;
  const indBoost = clamp((ctx.individualQuotaRemaining ?? 0) * 12, 0, 100);

  const priorityScore =
    Math.round(
      (role.score * 0.35 +
        leverage.score * 0.3 +
        access.score * 0.25 +
        indBoost * 0.1 -
        statusPenalty -
        accessGate) *
        10,
    ) / 10;

  return {
    access,
    leverage,
    roleFit: { score: role.score, breakdown: role.breakdown },
    priority: {
      score: priorityScore,
      breakdown: [
        {
          key: "role_w",
          label: "RoleFit × 0.35",
          points: Math.round(role.score * 0.35 * 10) / 10,
          max: 35,
        },
        {
          key: "lev_w",
          label: "Leverage × 0.30",
          points: Math.round(leverage.score * 0.3 * 10) / 10,
          max: 30,
        },
        {
          key: "acc_w",
          label: "Access × 0.25",
          points: Math.round(access.score * 0.25 * 10) / 10,
          max: 25,
        },
      ],
    },
  };
}
