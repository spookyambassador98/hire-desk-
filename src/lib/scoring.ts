import { matchPortfolio, portfolioProofPoints } from "./portfolio";
import { isAsiaOutLocation } from "./harvest/sources/types";
import type {
  FitBand,
  FitResult,
  HireProfile,
  Job,
  PriorityContext,
  PriorityResult,
  ReachResult,
  ScoreBreakdownItem,
} from "./types";
import { DEFAULT_HIRE_PROFILE } from "./types";

/**
 * Hire Desk scoring — three numbers, transparent weights.
 *
 * Fit        0–100  portfolio + role shape
 * Reach      0–100  how easy to apply / contact
 * Priority   sort   what to do today first
 *
 * Bands (Fit): 0–29 hide · 30–54 maybe · 55–74 queue · 75+ today-first
 */

const ROLE_POSITIVE: Array<{ re: RegExp; w: number; label: string }> = [
  {
    re: /\bai[-\s]?native\s+full[-\s]?stack\s+product\s+builder\b/i,
    w: 37,
    label: "AI-Native Full-Stack Product Builder",
  },
  {
    re: /\bai[-\s]?native\s+product\s+builder\b/i,
    w: 36,
    label: "AI-Native Product Builder",
  },
  {
    re: /\bai\s+solution\s+architect\b/i,
    w: 36,
    label: "AI Solution Architect",
  },
  {
    re: /\bfull[-\s]?stack\s+ai\b/i,
    w: 36,
    label: "Full-Stack AI Developer",
  },
  {
    re: /\bprompt\s+engineer\b/i,
    w: 35,
    label: "Prompt Engineer",
  },
  {
    re: /\bai[-\s]?powered\s+product\b/i,
    w: 35,
    label: "AI-Powered Product Developer",
  },
  {
    re: /\b(no[-\s]?code|low[-\s]?code).{0,24}\b(technical\s+lead|tech\s+lead|lead)\b|\b(technical\s+lead|tech\s+lead).{0,24}\b(no[-\s]?code|low[-\s]?code)\b/i,
    w: 34,
    label: "No-Code / Low-Code Technical Lead",
  },
  { re: /\bsolution\s+maker\b/i, w: 33, label: "Solution Maker" },
  { re: /\bai\s+engineer\b/i, w: 32, label: "AI Engineer" },
  { re: /\bsolution\s+architect\b/i, w: 30, label: "Solution Architect" },
  { re: /\bfounding\s+engineer\b/i, w: 35, label: "Founding Engineer" },
  { re: /\b0\s*[-–to]+\s*1\b|\bfirst\s+engineer\b/i, w: 34, label: "0→1 / First engineer" },
  { re: /\bproduct\s+builder\b/i, w: 34, label: "Product Builder" },
  {
    re: /\bfull[-\s]?stack\s+product\b/i,
    w: 33,
    label: "Full-stack Product",
  },
  { re: /\bproduct\s+engineer\b/i, w: 32, label: "Product Engineer" },
  { re: /\bcreative\s+technolog/i, w: 30, label: "Creative Technologist" },
  { re: /\binternal\s+tools?\b/i, w: 28, label: "Internal Tools" },
  { re: /\bops\s+(platform|tooling)\b/i, w: 28, label: "Ops Platform" },
  { re: /\bfull[-\s]?stack\b/i, w: 26, label: "Full-stack" },
  { re: /\bfront[-\s]?end\b/i, w: 22, label: "Frontend" },
  { re: /\bui\s+engineer\b/i, w: 20, label: "UI Engineer" },
  {
    re: /\b(node\.?js|typescript)\b.*\bbackend\b|\bbackend\b.*\b(node\.?js|typescript|firebase|supabase)\b/i,
    w: 20,
    label: "Node/TS Backend",
  },
  { re: /\bback[-\s]?end\s+engineer\b/i, w: 16, label: "Backend Engineer" },
  { re: /\bsoftware\s+engineer\b/i, w: 12, label: "Software Engineer" },
];

/** Skip anti hits when negated ("not body-shop", "no leetcode", etc.) */
function isNegated(text: string, matchIndex: number): boolean {
  const before = text
    .slice(Math.max(0, matchIndex - 40), matchIndex)
    .toLowerCase();
  return /\b(not|no|without|avoid|isn't|isnt|non)\b[\w\s\-,/]{0,32}$/i.test(
    before,
  );
}

const ANTI_FILTERS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\b(ml|machine\s+learning)\s+engineer\b|\bresearch\s+scientist\b/i,
    reason: "ML / research scientist role",
  },
  {
    re: /\bllm\s+research\b|\bfoundation\s+model\s+train/i,
    reason: "LLM research / training role",
  },
  {
    re: /\b(pytorch|tensorflow|jax)\b.*\b(required|must|experience)\b|\b(required|must)\b.*\b(pytorch|tensorflow)\b/i,
    reason: "ML framework core requirement",
  },
  {
    re: /\b(leetcode|hackerrank|codewars)\b.*\b(only|required|must)\b|\b(only|required|must)\b.*\b(leetcode|hackerrank)\b/i,
    reason: "Leetcode-only / algorithm gate",
  },
  {
    re: /\b(faang|meta|google|amazon|apple|netflix)\b.*\b(leetcode|dsa|algorithms?\s+interview)\b/i,
    reason: "FAANG leetcode track",
  },
  {
    re: /\b5\+?\s*years?\b.*\bjava\b|\bjava\b.*\b5\+?\s*years?\b/i,
    reason: "Java-only seniority gate",
  },
  {
    re: /\b(java\s+only|only\s+java)\b/i,
    reason: "Java-only role",
  },
  {
    re: /\b(pure\s+backend|backend[-\s]only)\b/i,
    reason: "Pure backend without product",
  },
  {
    re: /\b(body[-\s]?shop|outstaff|staff\s*aug|outsourcing\s+agency)\b/i,
    reason: "Agency body-shop / outstaff",
  },
  {
    re: /\b(upwork|fiverr|freelancer\.com|toptal\s+gig)\b/i,
    reason: "Freelance board / gig marketplace",
  },
];

function findAntiFilter(text: string): string | null {
  for (const anti of ANTI_FILTERS) {
    const m = anti.re.exec(text);
    if (m && m.index != null && !isNegated(text, m.index)) {
      return anti.reason;
    }
  }
  return null;
}

/**
 * Role title gates — block research/ML science titles only.
 * AI Solution Architect / Prompt / Full-Stack AI / No-Code Lead are priority keeps.
 */
function findRoleTitleAnti(role: string): string | null {
  const r = role || "";
  // Explicit allow — never anti these priority titles
  if (
    /\b(ai[-\s]?native\s+(full[-\s]?stack\s+)?product\s+builder|ai\s+solution\s+architect|full[-\s]?stack\s+ai|prompt\s+engineer|ai[-\s]?powered\s+product|no[-\s]?code|low[-\s]?code|ai\s+engineer|solution\s+maker|solution\s+architect)\b/i.test(
      r,
    )
  ) {
    return null;
  }
  if (
    /\b(machine\s+learning\s+engineer|ml\s+engineer|research\s+scientist|data\s+scientist|ai\s+research|llm\s+researcher)\b/i.test(
      r,
    )
  ) {
    return "ML / research science title";
  }
  return null;
}

const PRODUCT_LED_UP = [
  /\bproduct[-\s]?led\b/i,
  /\bsaas\b/i,
  /\bplatform\b/i,
  /\bops\s+console\b/i,
  /\bown\s+product\b/i,
  /\bbuild\s+from\s+scratch\b/i,
  /\b0\s*[-–to]+\s*1\b/i,
  /\bstartup\b/i,
  /\bseries\s+[a-c]\b/i,
  /\bearly\s+stage\b/i,
];

const PRODUCT_LED_DOWN = [
  /\bagency\b/i,
  /\bbody[-\s]?shop\b/i,
  /\boutstaff\b/i,
  /\bclient\s+services\b/i,
  /\bconsulting\s+boutique\b/i,
];

const STACK_SIGNALS: Array<{ re: RegExp; label: string }> = [
  { re: /\bnext\.?js\b/i, label: "Next.js" },
  { re: /\breact\b/i, label: "React" },
  { re: /\btypescript\b/i, label: "TypeScript" },
  { re: /\btailwind\b/i, label: "Tailwind" },
  { re: /\bfirebase\b|\bfirestore\b/i, label: "Firebase" },
  { re: /\bsupabase\b/i, label: "Supabase" },
  { re: /\bprisma\b/i, label: "Prisma" },
  { re: /\bnode\.?js\b|\bexpress\b/i, label: "Node" },
  { re: /\breal[-\s]?time\b|\bwebsocket\b|\bsocket\.?io\b/i, label: "Realtime" },
  { re: /\b(three\.?js|webgl|r3f|react\s+three)\b/i, label: "3D" },
  { re: /\bframer\s+motion\b|\bgsap\b/i, label: "Motion" },
];

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function jobText(job: Pick<Job, "role" | "description" | "company">) {
  return `${job.role}\n${job.company}\n${job.description}`;
}

function fitBand(score: number): FitBand {
  if (score >= 75) return "today";
  if (score >= 55) return "queue";
  if (score >= 30) return "maybe";
  return "hide";
}

function roleMatchPoints(text: string): ScoreBreakdownItem {
  let best = { w: 0, label: "No strong role keyword" };
  for (const row of ROLE_POSITIVE) {
    if (row.re.test(text) && row.w > best.w) {
      best = { w: row.w, label: row.label };
    }
  }
  return {
    key: "role",
    label: "Role match",
    points: best.w,
    max: 35,
    note: best.label,
  };
}

function companySignalPoints(text: string): ScoreBreakdownItem {
  let pts = 8; // neutral baseline inside 0–15
  const up = PRODUCT_LED_UP.some((re) => re.test(text));
  const down = PRODUCT_LED_DOWN.some((re) => re.test(text));
  if (up && !down) pts = 15;
  else if (up && down) pts = 10;
  else if (down) pts = 3;
  return {
    key: "company",
    label: "Product-led company",
    points: pts,
    max: 15,
    note: up ? "product-led ↑" : down ? "agency/body-shop ↓" : "neutral",
  };
}

function stackOverlapPoints(text: string): ScoreBreakdownItem {
  const hits = STACK_SIGNALS.filter((s) => s.re.test(text));
  // Cap at 10: 1 hit = 4, 2 = 7, 3+ = 10
  const points =
    hits.length === 0 ? 0 : hits.length === 1 ? 4 : hits.length === 2 ? 7 : 10;
  return {
    key: "stack",
    label: "Stack overlap",
    points,
    max: 10,
    note: hits.length ? hits.map((h) => h.label).join(", ") : "none",
  };
}

function compRealismPoints(
  job: Job,
  profile: HireProfile,
): ScoreBreakdownItem {
  const sal = job.salary;
  if (!sal || (sal.min == null && sal.max == null)) {
    return {
      key: "comp",
      label: "Comp realism",
      points: 3,
      max: 10,
      note: "No salary listed",
    };
  }
  const annualize = (n: number) => {
    if (sal.period === "month") return n * 12;
    if (sal.period === "hour") return n * 2080;
    return n;
  };
  const floor = profile.salaryFloor;
  const low = sal.min != null ? annualize(sal.min) : null;
  const high = sal.max != null ? annualize(sal.max) : null;
  const effective = high ?? low ?? 0;

  if (effective > 0 && effective < floor * 0.7) {
    return {
      key: "comp",
      label: "Comp realism",
      points: 0,
      max: 10,
      note: `Below floor (~${floor})`,
    };
  }
  if (low != null && low >= floor) {
    return {
      key: "comp",
      label: "Comp realism",
      points: 10,
      max: 10,
      note: "Range meets floor",
    };
  }
  if (high != null && high >= floor) {
    return {
      key: "comp",
      label: "Comp realism",
      points: 7,
      max: 10,
      note: "Top of range meets floor",
    };
  }
  return {
    key: "comp",
    label: "Comp realism",
    points: 5,
    max: 10,
    note: "Partial / unclear vs floor",
  };
}

export function computeFit(
  job: Job,
  profile: HireProfile = DEFAULT_HIRE_PROFILE,
): FitResult {
  const text = jobText(job);

  const antiReason =
    (isAsiaOutLocation(job.location)
      ? "India / MENA — outside Asia targets"
      : null) ||
    findRoleTitleAnti(job.role) ||
    findAntiFilter(text);
  if (antiReason) {
    return {
      score: 0,
      band: "hide",
      antiFiltered: true,
      antiFilterReason: antiReason,
      breakdown: [
        {
          key: "anti",
          label: "Anti-filter",
          points: 0,
          max: 100,
          note: antiReason,
        },
      ],
    };
  }

  const { proofs } = job.proofProjects?.length
    ? { proofs: job.proofProjects }
    : matchPortfolio(job);

  const role = roleMatchPoints(text);
  const portfolioPts = portfolioProofPoints(proofs.length);
  const portfolio: ScoreBreakdownItem = {
    key: "portfolio",
    label: "Portfolio proof",
    points: portfolioPts,
    max: 30,
    note:
      proofs.length === 0
        ? "No matcher hit"
        : proofs.map((p) => p.name).join(" + "),
  };
  const company = companySignalPoints(text);
  const stack = stackOverlapPoints(text);
  const comp = compRealismPoints(job, profile);

  const breakdown = [role, portfolio, company, stack, comp];
  const score = clamp(
    breakdown.reduce((s, b) => s + b.points, 0),
    0,
    100,
  );

  return {
    score,
    band: fitBand(score),
    antiFiltered: false,
    antiFilterReason: null,
    breakdown,
  };
}

export function computeReach(job: Job): ReachResult {
  const breakdown: ScoreBreakdownItem[] = [];
  let score = 0;

  const url = (job.url || "").toLowerCase();
  const ch = job.channel;

  const directApply =
    ch === "greenhouse" ||
    ch === "ashby" ||
    ch === "lever" ||
    /greenhouse\.io|ashbyhq\.com|lever\.co|jobs\.(eu|ashby)/i.test(url);

  if (directApply || ch === "careers") {
    const pts = directApply ? 40 : 10;
    score += pts;
    breakdown.push({
      key: "apply_url",
      label: directApply ? "Direct apply URL" : "Company careers only",
      points: pts,
      max: 40,
      note: ch,
    });
  } else if (ch === "linkedin_easy") {
    score += 15;
    breakdown.push({
      key: "linkedin_easy",
      label: "LinkedIn Easy Apply",
      points: 15,
      max: 40,
    });
  } else if (ch === "linkedin" || ch === "wellfound") {
    score += 15;
    breakdown.push({
      key: "board",
      label: "Public board / LinkedIn",
      points: 15,
      max: 40,
      note: ch,
    });
  } else if (!job.url || ch === "none") {
    score += 2;
    breakdown.push({
      key: "no_link",
      label: "No link / ask HR",
      points: 2,
      max: 40,
    });
  } else {
    score += 10;
    breakdown.push({
      key: "other_url",
      label: "Other URL",
      points: 10,
      max: 40,
      note: ch,
    });
  }

  const contact = job.contact;
  if (contact?.name && (contact.channel || contact.handle)) {
    score += 30;
    breakdown.push({
      key: "recruiter",
      label: "Recruiter / HM contact",
      points: 30,
      max: 30,
      note: `${contact.name}${contact.role ? ` (${contact.role})` : ""}`,
    });
  } else if (contact?.name) {
    score += 12;
    breakdown.push({
      key: "recruiter_name",
      label: "Named contact (no channel)",
      points: 12,
      max: 30,
      note: contact.name,
    });
  } else {
    breakdown.push({
      key: "recruiter",
      label: "Recruiter / HM contact",
      points: 0,
      max: 30,
      note: "none",
    });
  }

  // Soft floor if somehow empty
  if (score === 0) {
    score = 5;
    breakdown.push({
      key: "floor",
      label: "Weak reach floor",
      points: 5,
      max: 5,
    });
  }

  return { score: clamp(score, 0, 100), breakdown };
}

function daysSince(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 7;
  return Math.max(0, (nowMs - t) / (1000 * 60 * 60 * 24));
}

/** Age reference: source post time when known. */
function ageIso(job: Job): string {
  return job.postedAt || job.createdAt;
}

/**
 * Freshness 0–100 — steep curve.
 * Full when <12h, ~half at ~3d, ~0 at 7d. Stale (>7d) scored 0 here + extra penalty.
 */
function freshnessPoints(iso: string, nowMs: number): number {
  const d = daysSince(iso, nowMs);
  if (d > 7) return 0;
  return clamp(Math.round(100 * Math.pow(1 - d / 7, 1.55)), 0, 100);
}

/** After 7 days the seat is usually gone — bury hard. */
function stalePenalty(iso: string, nowMs: number): number {
  const d = daysSince(iso, nowMs);
  if (d <= 7) return 0;
  return clamp(18 + (d - 7) * 4, 18, 55);
}

function statusPenalty(status: Job["status"]): number {
  switch (status) {
    case "new":
    case "queued":
      return 0;
    case "applied":
      return 15;
    case "follow_up":
      return 10;
    case "replied":
      return 5;
    case "rejected":
      return 40;
    case "interview":
    case "offer":
      return 100; // should not be in daily apply queue
    default:
      return 0;
  }
}

/**
 * Priority sort key (not a card KPI %).
 * priority = Fit*0.45 + Reach*0.20 + freshness*0.25 + quotaBoost*0.10 − penalties
 * Fresh post (<7d) floats; older than a week sinks.
 */
export function computePriority(
  job: Job,
  fit: FitResult,
  reach: ReachResult,
  ctx: PriorityContext,
): PriorityResult {
  const nowMs = ctx.now ? Date.parse(ctx.now) : Date.now();
  const posted = ageIso(job);
  const fresh = freshnessPoints(posted, nowMs);
  const stale = stalePenalty(posted, nowMs);

  let quotaBoost = 0;
  if (job.region === "europe" && ctx.europeQuotaRemaining > 0) {
    quotaBoost = clamp(ctx.europeQuotaRemaining * 10, 0, 100);
  } else if (job.region === "america" && ctx.americaQuotaRemaining > 0) {
    quotaBoost = clamp(ctx.americaQuotaRemaining * 10, 0, 100);
  } else if (job.region === "asia" && ctx.asiaQuotaRemaining > 0) {
    quotaBoost = clamp(ctx.asiaQuotaRemaining * 10, 0, 100);
  }

  // Body-shop company signal → Priority penalty (Fit stays honest)
  const text = jobText(job);
  let companyPenalty = 0;
  const downHit = PRODUCT_LED_DOWN.map((re) => re.exec(text)).find(
    (m) => m && m.index != null && !isNegated(text, m.index),
  );
  if (downHit) {
    companyPenalty = findAntiFilter(text) ? 20 : 12;
  }

  const penalty = statusPenalty(job.status) + companyPenalty + stale;

  const weighted =
    fit.score * 0.45 +
    reach.score * 0.2 +
    fresh * 0.25 +
    quotaBoost * 0.1 -
    penalty;

  const score = Math.round(weighted * 10) / 10;
  const ageDays = Math.round(daysSince(posted, nowMs) * 10) / 10;

  return {
    score,
    breakdown: [
      {
        key: "fit_w",
        label: "Fit × 0.45",
        points: Math.round(fit.score * 0.45 * 10) / 10,
        max: 45,
      },
      {
        key: "reach_w",
        label: "Reach × 0.20",
        points: Math.round(reach.score * 0.2 * 10) / 10,
        max: 20,
      },
      {
        key: "fresh_w",
        label: "Freshness × 0.25",
        points: Math.round(fresh * 0.25 * 10) / 10,
        max: 25,
        note: `${Math.round(fresh)} raw · ${ageDays}d`,
      },
      {
        key: "quota_w",
        label: "Quota boost × 0.10",
        points: Math.round(quotaBoost * 0.1 * 10) / 10,
        max: 10,
        note: job.region,
      },
      {
        key: "penalty",
        label: "Status / stale / company",
        points: -penalty,
        max: 0,
        note: stale ? `${job.status} · stale>${7}d` : job.status,
      },
    ],
  };
}

export function scoreJob(
  job: Job,
  ctx: PriorityContext,
  profile: HireProfile = DEFAULT_HIRE_PROFILE,
) {
  const fit = computeFit(job, profile);
  const reach = computeReach(job);
  const priority = computePriority(job, fit, reach, ctx);
  return { fit, reach, priority };
}

export function enrichJobProofs(job: Job): Job {
  if (job.proofProjects?.length && job.whyFit) return job;
  const { proofs, whyFit } = matchPortfolio(job);
  return {
    ...job,
    proofProjects: proofs,
    whyFit,
  };
}
