import { envNum } from "@/lib/env";
import type { Region } from "@/lib/types";

export type RoleFamily =
  | "founding"
  | "fullstack"
  | "frontend"
  | "backend"
  | "ops";

export type HireSegmentId =
  | "europe_founding"
  | "europe_fullstack"
  | "europe_frontend"
  | "europe_backend"
  | "europe_ops"
  | "america_founding"
  | "america_fullstack"
  | "america_frontend"
  | "america_backend"
  | "america_ops"
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

/** Shared keyword banks — product builder profile, not ML/LLM. */
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

/**
 * Fill scarcest region in the DB first, then scarcest segment today.
 * Example: Asia 0 / Europe 99 / America 100 → all Asia shelves run before EU/US.
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
