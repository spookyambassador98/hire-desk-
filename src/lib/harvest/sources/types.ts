import type { ApplyChannel, Region } from "@/lib/types";
import { matchesAiHarvestCatch, type HireSegment } from "../max";

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
  if (segment.family === "ai") return matchesAiHarvestCatch(text);
  const t = text.toLowerCase();
  return segment.keywords.some((kw) => t.includes(kw.toLowerCase()));
}

const ASIA_RE =
  /\b(singapore|tokyo|japan|korea|seoul|hong\s*kong|taiwan|bangkok|jakarta|manila|vietnam|hanoi|ho\s*chi\s*minh|shanghai|beijing|shenzhen|hangzhou|guangzhou|sydney|melbourne|auckland|brisbane|perth|apac|asia[- ]?pacific|remote[- ]?apac|philippines|malaysia|indonesia|thailand|australia|new\s*zealand)\b/i;

/**
 * Not target Asia for this desk — India + GCC/MENA must never land on Asia rail.
 */
export const ASIA_OUT_RE =
  /\b(india|indian|bangalore|bengaluru|hyderabad|mumbai|delhi|pune|chennai|kolkata|gurgaon|gurugram|noida|dubai|uae|u\.a\.e\.?|united\s+arab|abu\s+dhabi|saudi|riyadh|qatar|doha|kuwait|bahrain|oman|pakistan|bangladesh|sri\s+lanka|nepal|middle\s+east|mena)\b/i;

export function isAsiaOutLocation(text: string | null | undefined): boolean {
  const t = (text || "").toLowerCase().replace(/\u00a0/g, " ");
  return Boolean(t.trim()) && ASIA_OUT_RE.test(t);
}

const AMERICA_RE =
  /\b(usa|u\.s\.a?\.?|united\s+states|canada|latam|mexico|brazil|argentina|colombia|chile|peru|nyc|new\s+york|brooklyn|manhattan|san\s+francisco|sf\s+bay|bay\s+area|los\s+angeles|seattle|austin|boston|chicago|denver|miami|portland|atlanta|dallas|houston|phoenix|san\s+diego|san\s+jose|palo\s+alto|mountain\s+view|washington\s*d\.?c\.?|toronto|vancouver|montreal|ottawa|remote[- ]?us|remote[- ]?usa|americas?|california|texas|massachusetts|colorado|florida|washington\s+state)\b|,?\s*(ca|ny|wa|tx|ma|il|co|fl|or|ga|az|nc|pa)\b(?!\s*[a-z])/i;

const EUROPE_RE =
  /\b(europe|eu\b|emea|uk\b|united\s+kingdom|england|scotland|ireland|germany|france|netherlands|spain|portugal|italy|sweden|norway|denmark|finland|belgium|austria|switzerland|poland|czech|romania|ukraine|lisbon|london|paris|berlin|munich|amsterdam|dublin|stockholm|oslo|copenhagen|helsinki|warsaw|prague|vienna|zurich|barcelona|madrid|milan|rome|remote[- ]?eu|remote[- ]?emea)\b/i;

/**
 * Strong geographic signal only — null if text has no clear region.
 * Prefer location strings over long job descriptions.
 */
export function detectRegionFromText(text: string): Region | null {
  const t = (text || "").toLowerCase().replace(/\u00a0/g, " ");
  if (!t.trim()) return null;
  // India / Dubai etc. are never Asia on this desk
  if (isAsiaOutLocation(t)) return null;
  if (ASIA_RE.test(t)) return "asia";
  if (AMERICA_RE.test(t)) return "america";
  if (EUROPE_RE.test(t)) return "europe";
  return null;
}

export function inferRegionFromText(
  text: string,
  fallback: Region,
): Region {
  return detectRegionFromText(text) ?? fallback;
}

/**
 * Keep hit only if location (or short blob) matches the harvest segment.
 * Empty / ambiguous location → keep with segment.region (remote boards).
 * India / MENA never accepted on Asia shelves.
 */
export function regionForSegmentHit(
  locationOrBlob: string | null | undefined,
  segment: HireSegment,
): Region | null {
  const loc = locationOrBlob || "";
  if (segment.region === "asia" && isAsiaOutLocation(loc)) return null;
  const detected = detectRegionFromText(loc);
  if (detected && detected !== segment.region) return null;
  return detected ?? segment.region;
}

/**
 * Remote boards often list "Worldwide" or "Americas, Europe".
 * Accept when: empty/worldwide, mentions this shelf, or sole detect matches.
 */
export function regionForRemoteSegmentHit(
  locationOrBlob: string | null | undefined,
  segment: HireSegment,
): Region | null {
  const loc = (locationOrBlob || "").trim();
  if (segment.region === "asia" && isAsiaOutLocation(loc)) return null;
  if (!loc || /\b(worldwide|anywhere|global|remote)\b/i.test(loc)) {
    return segment.region;
  }
  const mentionsShelf =
    segment.region === "america"
      ? /\b(america|americas|usa|u\.s\.a?\.?|canada|latam|united\s+states)\b/i
      : segment.region === "europe"
        ? /\b(europe|eu\b|emea|uk\b|united\s+kingdom|england|germany|france|netherlands|ireland)\b/i
        : ASIA_RE;
  if (mentionsShelf.test(loc)) return segment.region;
  return regionForSegmentHit(loc, segment);
}
