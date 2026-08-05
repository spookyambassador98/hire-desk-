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
  | "asia_ai";

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
];

export function dayCeiling() {
  return HIRE_DAILY_QUOTA * HIRE_SEGMENTS.length;
}

/** Scarce shelves first; rotate by UTC hour. */
export function prioritizedSegments(
  todayCounts: Partial<Record<HireSegmentId, number>>,
  now = new Date(),
): HireSegment[] {
  const rot = now.getUTCHours() % HIRE_SEGMENTS.length;
  const rotated = [
    ...HIRE_SEGMENTS.slice(rot),
    ...HIRE_SEGMENTS.slice(0, rot),
  ];
  return [...rotated].sort((a, b) => {
    const ca = todayCounts[a.id] ?? 0;
    const cb = todayCounts[b.id] ?? 0;
    if (ca !== cb) return ca - cb;
    return 0;
  });
}

export function segmentRemaining(
  id: HireSegmentId,
  todayCounts: Partial<Record<HireSegmentId, number>>,
) {
  return Math.max(0, HIRE_DAILY_QUOTA - (todayCounts[id] ?? 0));
}
