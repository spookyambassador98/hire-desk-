import { envNum } from "@/lib/env";
import type { Region } from "@/lib/types";

export type RoleFamily = "product" | "founding" | "ai" | "ops";

export type HireSegmentId =
  | "europe_product"
  | "europe_founding"
  | "europe_ai"
  | "europe_ops"
  | "america_product"
  | "america_founding"
  | "america_ai"
  | "america_ops"
  | "asia_product"
  | "asia_founding"
  | "asia_ai"
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

export const HIRE_SEGMENTS: HireSegment[] = [
  {
    id: "europe_product",
    label: "Europe · Product",
    region: "europe",
    family: "product",
    keywords: [
      "product engineer",
      "full-stack product",
      "fullstack",
      "product builder",
    ],
  },
  {
    id: "europe_founding",
    label: "Europe · Founding",
    region: "europe",
    family: "founding",
    keywords: ["founding engineer", "founding fullstack", "early engineer"],
  },
  {
    id: "europe_ai",
    label: "Europe · AI Product",
    region: "europe",
    family: "ai",
    keywords: [
      "ai product",
      "ai engineer",
      "llm",
      "rapid prototyping",
      "creative technologist",
    ],
  },
  {
    id: "europe_ops",
    label: "Europe · Ops / Tools",
    region: "europe",
    family: "ops",
    keywords: [
      "internal tools",
      "ops platform",
      "platform engineer",
      "automation",
    ],
  },
  {
    id: "america_product",
    label: "America · Product",
    region: "america",
    family: "product",
    keywords: [
      "product engineer",
      "full-stack product",
      "fullstack",
      "product builder",
    ],
  },
  {
    id: "america_founding",
    label: "America · Founding",
    region: "america",
    family: "founding",
    keywords: ["founding engineer", "founding fullstack", "early engineer"],
  },
  {
    id: "america_ai",
    label: "America · AI Product",
    region: "america",
    family: "ai",
    keywords: [
      "ai product",
      "ai engineer",
      "llm",
      "rapid prototyping",
      "creative technologist",
    ],
  },
  {
    id: "america_ops",
    label: "America · Ops / Tools",
    region: "america",
    family: "ops",
    keywords: [
      "internal tools",
      "ops platform",
      "platform engineer",
      "automation",
    ],
  },
  {
    id: "asia_product",
    label: "Asia · Product",
    region: "asia",
    family: "product",
    keywords: [
      "product engineer",
      "full-stack",
      "fullstack",
      "product builder",
    ],
  },
  {
    id: "asia_founding",
    label: "Asia · Founding",
    region: "asia",
    family: "founding",
    keywords: [
      "founding engineer",
      "founding fullstack",
      "early engineer",
      "startup engineer",
    ],
  },
  {
    id: "asia_ai",
    label: "Asia · AI / Builder",
    region: "asia",
    family: "ai",
    keywords: [
      "ai engineer",
      "ml engineer",
      "llm",
      "generative ai",
      "rapid prototyping",
    ],
  },
  {
    id: "asia_ops",
    label: "Asia · Ops / Tools",
    region: "asia",
    family: "ops",
    keywords: [
      "internal tools",
      "ops platform",
      "platform engineer",
      "automation",
    ],
  },
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
