import type { ApplyChannel, Region } from "@/lib/types";
import type { HireSegment } from "../max";

export type JobHit = {
  sourceId: string;
  company: string;
  role: string;
  region: Region;
  location: string | null;
  remote: boolean | null;
  description: string;
  url: string | null;
  channel: ApplyChannel;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  /** Free-text salary from APIs like Remotive */
  salaryText?: string | null;
  /** Source post / publish time ISO */
  postedAt?: string | null;
};

export type HireSourceContext = {
  segment: HireSegment;
  limit: number;
  log: (msg: string) => Promise<void> | void;
  signal?: AbortSignal;
};

export type JobSource = {
  id: string;
  label: string;
  tier: "primary" | "secondary" | "tertiary" | "import";
  enabled: () => boolean;
  harvest: (ctx: HireSourceContext) => Promise<JobHit[]>;
};

export function textMatchesSegment(
  text: string,
  segment: HireSegment,
): boolean {
  const t = text.toLowerCase();
  return segment.keywords.some((kw) => t.includes(kw.toLowerCase()));
}

export function inferRegionFromText(
  text: string,
  fallback: Region,
): Region {
  const t = text.toLowerCase();
  if (
    /\b(singapore|tokyo|japan|korea|seoul|hong\s*kong|taiwan|bangkok|jakarta|manila|vietnam|india|bangalore|bengaluru|hyderabad|remote[- ]?apac|asia[- ]?pacific|apac)\b/.test(
      t,
    )
  ) {
    return "asia";
  }
  if (
    /\b(usa|united states|canada|latam|nyc|sf bay|remote[- ]?us|america)\b/.test(
      t,
    )
  ) {
    return "america";
  }
  if (
    /\b(europe|eu\b|uk\b|germany|berlin|amsterdam|lisbon|remote[- ]?eu)\b/.test(
      t,
    )
  ) {
    return "europe";
  }
  return fallback;
}
