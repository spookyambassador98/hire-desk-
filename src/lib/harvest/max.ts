import { envNum } from "@/lib/env";
import type { Region } from "@/lib/types";

export type RoleFamily =
  | "ai"
  | "founding"
  | "fullstack"
  | "frontend"
  | "backend"
  | "ops";

export type HireSegmentId =
  | "europe_ai"
  | "europe_founding"
  | "europe_fullstack"
  | "europe_frontend"
  | "europe_backend"
  | "europe_ops"
  | "america_ai"
  | "america_founding"
  | "america_fullstack"
  | "america_frontend"
  | "america_backend"
  | "america_ops"
  | "asia_ai"
  | "asia_founding"
  | "asia_fullstack"
  | "asia_frontend"
  | "asia_backend"
  | "asia_ops";

export type HireSegment = {
  id: HireSegmentId;
  label: string;
  region: Region;
  family: RoleFamily;
  /** Search / filter keywords for APIs */
  keywords: string[];
};

export const HIRE_DAILY_QUOTA = envNum("HIRE_DAILY_QUOTA", 40);
export const HIRE_RUN_TARGET = envNum("HIRE_RUN_TARGET", 80);

/**
 * Priority search bank — AI product / prompt / no-code lead roles.
 * Remote boards prefer these first (MAX LIVE + WRITE HARVEST).
 */
export const KW_AI = [
  "ai solution architect",
  "ai-native full-stack product builder",
  "ai native fullstack product builder",
  "ai-native product builder",
  "full-stack ai developer",
  "fullstack ai developer",
  "full stack ai",
  "prompt engineer",
  "ai-powered product developer",
  "ai powered product",
  "no-code technical lead",
  "low-code technical lead",
  "nocode lead",
  "lowcode lead",
  "ai engineer",
  "solution maker",
  "ai product developer",
  "solution architect ai",
];

/** Shared keyword banks — product builder + AI product track. */
const KW_FOUNDING = [
  "founding engineer",
  "founding fullstack",
  "first engineer",
  "early engineer",
  "0-1",
  "0 to 1",
  "early stage",
  "build from scratch",
  "solo fullstack",
  "own the product",
  "startup engineer",
];

const KW_FULLSTACK = [
  "full-stack",
  "fullstack",
  "full stack",
  "product engineer",
  "full-stack product",
  "product builder",
  "next.js",
  "react typescript",
];

const KW_FRONTEND = [
  "frontend engineer",
  "front-end engineer",
  "frontend developer",
  "react engineer",
  "next.js",
  "ui engineer",
  "creative technologist",
];

const KW_BACKEND = [
  "backend engineer",
  "back-end engineer",
  "node.js",
  "nodejs",
  "typescript backend",
  "firebase",
  "supabase",
  "express",
];

const KW_OPS = [
  "internal tools",
  "ops platform",
  "ops tooling",
  "platform engineer",
  "automation",
  "growth engineer",
];

function seg(
  id: HireSegmentId,
  label: string,
  region: Region,
  family: RoleFamily,
  keywords: string[],
): HireSegment {
  return { id, label, region, family, keywords };
}

export const HIRE_SEGMENTS: HireSegment[] = [
  // AI product track first — search priority
  seg("europe_ai", "Europe · AI Product / Prompt", "europe", "ai", KW_AI),
  seg("america_ai", "America · AI Product / Prompt", "america", "ai", KW_AI),
  seg("asia_ai", "Asia · AI Product / Prompt", "asia", "ai", KW_AI),

  seg("europe_founding", "Europe · Founding 0→1", "europe", "founding", KW_FOUNDING),
  seg("europe_fullstack", "Europe · Fullstack", "europe", "fullstack", KW_FULLSTACK),
  seg("europe_frontend", "Europe · Frontend", "europe", "frontend", KW_FRONTEND),
  seg("europe_backend", "Europe · Backend Node", "europe", "backend", KW_BACKEND),
  seg("europe_ops", "Europe · Ops / Tools", "europe", "ops", KW_OPS),

  seg("america_founding", "America · Founding 0→1", "america", "founding", KW_FOUNDING),
  seg("america_fullstack", "America · Fullstack", "america", "fullstack", KW_FULLSTACK),
  seg("america_frontend", "America · Frontend", "america", "frontend", KW_FRONTEND),
  seg("america_backend", "America · Backend Node", "america", "backend", KW_BACKEND),
  seg("america_ops", "America · Ops / Tools", "america", "ops", KW_OPS),

  seg("asia_founding", "Asia · Founding 0→1", "asia", "founding", KW_FOUNDING),
  seg("asia_fullstack", "Asia · Fullstack", "asia", "fullstack", KW_FULLSTACK),
  seg("asia_frontend", "Asia · Frontend", "asia", "frontend", KW_FRONTEND),
  seg("asia_backend", "Asia · Backend Node", "asia", "backend", KW_BACKEND),
  seg("asia_ops", "Asia · Ops / Tools", "asia", "ops", KW_OPS),
];

export function dayCeiling() {
  return HIRE_DAILY_QUOTA * HIRE_SEGMENTS.length;
}

export function dayQuotaUsed(
  bySegment: Partial<Record<HireSegmentId, number>>,
): number {
  let n = 0;
  for (const s of HIRE_SEGMENTS) n += bySegment[s.id] ?? 0;
  return n;
}

export function dayQuotaRemaining(
  bySegment: Partial<Record<HireSegmentId, number>>,
): number {
  return Math.max(0, dayCeiling() - dayQuotaUsed(bySegment));
}

export function anySegmentOpen(
  bySegment: Partial<Record<HireSegmentId, number>>,
): boolean {
  return HIRE_SEGMENTS.some(
    (s) => segmentRemaining(s.id, bySegment) > 0,
  );
}

export type RegionInventory = Partial<Record<Region, number>>;

function familyRank(family: RoleFamily): number {
  // Lower = earlier. AI product track always first.
  if (family === "ai") return 0;
  if (family === "founding") return 1;
  if (family === "fullstack") return 2;
  if (family === "frontend") return 3;
  if (family === "backend") return 4;
  return 5;
}

/**
 * AI shelves first, then scarcest region, then scarcest segment today.
 */
export function prioritizedSegments(
  todayCounts: Partial<Record<HireSegmentId, number>>,
  regionInventory: RegionInventory = {},
  now = new Date(),
): HireSegment[] {
  const rot = now.getUTCHours() % HIRE_SEGMENTS.length;
  const rotated = [
    ...HIRE_SEGMENTS.slice(rot),
    ...HIRE_SEGMENTS.slice(0, rot),
  ];
  return [...rotated].sort((a, b) => {
    const fa = familyRank(a.family);
    const fb = familyRank(b.family);
    if (fa !== fb) return fa - fb;
    const ra = regionInventory[a.region] ?? 0;
    const rb = regionInventory[b.region] ?? 0;
    if (ra !== rb) return ra - rb;
    const ca = todayCounts[a.id] ?? 0;
    const cb = todayCounts[b.id] ?? 0;
    if (ca !== cb) return ca - cb;
    return 0;
  });
}

export function countJobsByRegion(jobs: { region: Region }[]): RegionInventory {
  const out: RegionInventory = { europe: 0, america: 0, asia: 0 };
  for (const j of jobs) {
    if (j.region === "america") out.america = (out.america ?? 0) + 1;
    else if (j.region === "asia") out.asia = (out.asia ?? 0) + 1;
    else out.europe = (out.europe ?? 0) + 1;
  }
  return out;
}

export function segmentRemaining(
  id: HireSegmentId,
  todayCounts: Partial<Record<HireSegmentId, number>>,
) {
  return Math.max(0, HIRE_DAILY_QUOTA - (todayCounts[id] ?? 0));
}

/** Title/blob match for AI product priority roles (harvest ranking). */
export const PRIORITY_AI_ROLE_RE =
  /\b(ai[-\s]?native\s+full[-\s]?stack\s+product\s+builder|ai[-\s]?native\s+product\s+builder|ai\s+solution\s+architect|full[-\s]?stack\s+ai|prompt\s+engineer|ai[-\s]?powered\s+product|no[-\s]?code|low[-\s]?code|ai\s+engineer|solution\s+maker|solution\s+architect|ai\s+product\s+developer)\b/i;

export function matchesPriorityAiRole(text: string): boolean {
  return PRIORITY_AI_ROLE_RE.test(text || "");
}
