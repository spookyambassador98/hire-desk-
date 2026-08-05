/** Hire Desk domain types — jobs, pipeline, scores */

export type Region = "europe" | "america" | "asia";

export type JobStatus =
  | "new"
  | "queued"
  | "applied"
  | "follow_up"
  | "replied"
  | "interview"
  | "offer"
  | "rejected";

export type ApplyChannel =
  | "greenhouse"
  | "ashby"
  | "lever"
  | "careers"
  | "linkedin_easy"
  | "linkedin"
  | "wellfound"
  | "email"
  | "other"
  | "none";

export type PortfolioProjectId =
  | "foamcore"
  | "asema"
  | "orbital"
  | "art_of_look"
  | "lead_desk"
  | "apex";

export type FitBand = "hide" | "maybe" | "queue" | "today";

export type ScoreBreakdownItem = {
  key: string;
  label: string;
  points: number;
  max: number;
  note?: string;
};

export type FitResult = {
  score: number;
  band: FitBand;
  antiFiltered: boolean;
  antiFilterReason: string | null;
  breakdown: ScoreBreakdownItem[];
};

export type ReachResult = {
  score: number;
  breakdown: ScoreBreakdownItem[];
};

export type PriorityContext = {
  /** Daily EU quota remaining (e.g. 12 - appliedTodayEU) */
  europeQuotaRemaining: number;
  americaQuotaRemaining: number;
  asiaQuotaRemaining: number;
  /** ISO now; defaults to Date.now in scorer */
  now?: string;
};

export type PriorityResult = {
  /** Sort key — higher = work first in Queue */
  score: number;
  breakdown: ScoreBreakdownItem[];
};

export type JobScores = {
  fit: FitResult;
  reach: ReachResult;
  priority: PriorityResult;
};

export type ContactPerson = {
  name: string;
  role?: string | null;
  channel?: string | null; /** email | linkedin | twitter */
  handle?: string | null;
};

export type SalaryRange = {
  min: number | null;
  max: number | null;
  currency: string;
  period: "year" | "month" | "hour";
};

export type ProofMatch = {
  projectId: PortfolioProjectId;
  name: string;
  demoUrl: string | null;
  why: string;
};

export type Job = {
  id: string;
  company: string;
  role: string;
  region: Region;
  location: string | null;
  remote: boolean | null;
  description: string;
  salary: SalaryRange | null;
  url: string | null;
  channel: ApplyChannel;
  contact: ContactPerson | null;
  status: JobStatus;
  notes: string | null;
  /** Cached matcher output; recomputed if missing */
  proofProjects?: ProofMatch[];
  whyFit?: string | null;
  source: string | null;
  appliedAt: string | null;
  followUpAt: string | null;
  /** Original post time from source when known; else null → use createdAt */
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Profile knobs for Fit / Priority */
export type HireProfile = {
  salaryFloor: number;
  salaryCurrency: string;
  /** Daily apply targets (8–12 band) */
  europeDailyQuota: number;
  americaDailyQuota: number;
  asiaDailyQuota: number;
  /** Cold emails to individuals per day */
  individualDailyQuota: number;
};

export const DEFAULT_HIRE_PROFILE: HireProfile = {
  salaryFloor: 60_000,
  salaryCurrency: "USD",
  europeDailyQuota: 10,
  americaDailyQuota: 10,
  asiaDailyQuota: 10,
  individualDailyQuota: 4,
};

export type AppView =
  | "queue"
  | "individuals"
  | "applied"
  | "harvest"
  | "templates"
  | "history"
  | "admin";

export type ScoredJob = Job & {
  scores: JobScores;
};

/** Direct outreach — HR / senior / founder (not ATS apply) */
export type IndividualKind =
  | "hr"
  | "hiring_manager"
  | "senior_eng"
  | "founder"
  | "recruiter"
  | "other";

export type IndividualStatus =
  | "new"
  | "queued"
  | "emailed"
  | "replied"
  | "intro"
  | "closed";

export type Individual = {
  id: string;
  name: string;
  kind: IndividualKind;
  title: string | null;
  company: string;
  region: Region;
  email: string | null;
  linkedin: string | null;
  /** Optional link to a Job.id */
  linkedJobId: string | null;
  targetRole: string | null;
  notes: string | null;
  status: IndividualStatus;
  proofProjects?: ProofMatch[];
  whyFit?: string | null;
  source: string | null;
  emailedAt: string | null;
  followUpAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IndividualScoreBlock = {
  score: number;
  breakdown: ScoreBreakdownItem[];
};

export type IndividualScores = {
  access: IndividualScoreBlock;
  leverage: IndividualScoreBlock;
  roleFit: IndividualScoreBlock;
  priority: PriorityResult;
};

export type ScoredIndividual = Individual & {
  scores: IndividualScores;
};

export type QuotaLane = {
  used: number;
  quota: number;
  remaining: number;
};

export type QuotaSnapshot = {
  europe: QuotaLane;
  america: QuotaLane;
  asia: QuotaLane;
  individuals: QuotaLane;
};

export type FollowUpInfo = {
  silentDays: number;
  stage: 3 | 7 | 14 | null;
  due: boolean;
  label: string;
};
