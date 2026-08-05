import type { Region, SalaryRange } from "@/lib/types";

export function regionLabel(region: Region): string {
  if (region === "europe") return "Europe";
  if (region === "america") return "America";
  return "Asia";
}

export function regionClass(region: Region): "eu" | "us" | "asia" {
  if (region === "europe") return "eu";
  if (region === "america") return "us";
  return "asia";
}

export function defaultCurrency(region: Region): string {
  if (region === "europe") return "EUR";
  if (region === "asia") return "USD";
  return "USD";
}

/** Best timestamp for “when was this posting opened”. */
export function jobPostedAt(job: {
  postedAt?: string | null;
  createdAt: string;
}): string {
  return job.postedAt || job.createdAt;
}

/**
 * Human age chip: "age 5h" / "age 3d" / "age 2w".
 * Prefer hours under 48h, then days.
 */
export function postAgeLabel(
  iso: string,
  nowMs = Date.now(),
): { label: string; days: number; stale: boolean } {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) {
    return { label: "age ?", days: 7, stale: false };
  }
  const ms = Math.max(0, nowMs - t);
  const hours = ms / (1000 * 60 * 60);
  const days = ms / (1000 * 60 * 60 * 24);
  const stale = days > 7;
  if (hours < 1) return { label: "age <1h", days, stale };
  if (hours < 48) {
    return { label: `age ${Math.max(1, Math.round(hours))}h`, days, stale };
  }
  if (days < 14) {
    return { label: `age ${Math.max(1, Math.round(days))}d`, days, stale };
  }
  return {
    label: `age ${Math.max(1, Math.round(days / 7))}w`,
    days,
    stale,
  };
}

function toYearly(n: number, period: SalaryRange["period"]): number {
  if (period === "hour") return Math.round(n * 40 * 52);
  if (period === "month") return Math.round(n * 12);
  return n;
}

function parseMoneyToken(raw: string): number | null {
  const t = raw.replace(/,/g, "").trim().toLowerCase();
  const m = t.match(/^(\d+(?:\.\d+)?)(k)?$/i);
  if (!m) return null;
  let n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  if (m[2]) n *= 1000;
  return n;
}

/**
 * Pull salary from free text / Remotive-style strings.
 * Examples: "$120k–$160k", "€80,000 - €100,000", "USD 90000", "120-150k"
 */
export function parseSalaryText(
  raw: string,
  fallbackCurrency = "USD",
): SalaryRange | null {
  if (!raw?.trim()) return null;
  const text = raw.replace(/\u00a0/g, " ");

  const currency =
    /€|eur\b/i.test(text)
      ? "EUR"
      : /£|gbp\b/i.test(text)
        ? "GBP"
        : /¥|jpy\b|₩|krw\b/i.test(text)
          ? /₩|krw/i.test(text)
            ? "KRW"
            : "JPY"
          : /\$|usd\b/i.test(text)
            ? "USD"
            : fallbackCurrency;

  let period: SalaryRange["period"] = "year";
  if (/\b(per\s*hour|\/\s*hr|hourly)\b/i.test(text)) period = "hour";
  else if (/\b(per\s*month|\/\s*mo|monthly)\b/i.test(text)) period = "month";

  const range =
    text.match(
      /(?:USD|EUR|GBP|\$|€|£)?\s*([\d.,]+\s*k?)\s*[-–—to]+\s*(?:USD|EUR|GBP|\$|€|£)?\s*([\d.,]+\s*k?)/i,
    ) ||
    text.match(
      /([\d.,]+)\s*k\s*[-–—to]+\s*([\d.,]+)\s*k/i,
    );

  if (range) {
    let min = parseMoneyToken(range[1]!.replace(/\s/g, ""));
    let max = parseMoneyToken(range[2]!.replace(/\s/g, ""));
    if (min == null && max == null) return null;
    if (min != null) min = toYearly(min, period);
    if (max != null) max = toYearly(max, period);
    // If both look like hourly leftovers already converted, keep year
    return {
      min,
      max,
      currency,
      period: "year",
    };
  }

  const single = text.match(
    /(?:USD|EUR|GBP|\$|€|£)\s*([\d.,]+\s*k?)|\b([\d.,]+\s*k)\b/i,
  );
  if (single) {
    const token = (single[1] || single[2] || "").replace(/\s/g, "");
    let n = parseMoneyToken(token);
    if (n == null) return null;
    n = toYearly(n, period);
    if (n < 15_000 && period === "year") return null; // noise
    return { min: n, max: null, currency, period: "year" };
  }

  return null;
}

export function resolveSalary(opts: {
  min: number | null;
  max: number | null;
  currency: string | null;
  description?: string;
  salaryText?: string | null;
  region?: Region;
}): SalaryRange | null {
  if (opts.min != null || opts.max != null) {
    return {
      min: opts.min,
      max: opts.max,
      currency: opts.currency || defaultCurrency(opts.region || "america"),
      period: "year",
    };
  }
  const blob = [opts.salaryText || "", opts.description || ""].join(" ");
  return parseSalaryText(
    blob,
    defaultCurrency(opts.region || "america"),
  );
}
