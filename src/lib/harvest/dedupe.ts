/** Stable identity for harvest dedupe — prefer normalized URL. */

export function normalizeJobUrl(raw: string | null | undefined): string {
  const s = (raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    u.hash = "";
    for (const key of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "gh_src",
      "ref",
      "source",
    ]) {
      u.searchParams.delete(key);
    }
    let out = u.toString().toLowerCase();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return s.toLowerCase().replace(/\/$/, "");
  }
}

function normText(s: string) {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s+#.·]/gu, "")
    .trim();
}

/** Primary dedupe key for jobs / hits. */
export function jobDedupeKey(input: {
  company: string;
  role: string;
  url?: string | null;
}): string {
  const url = normalizeJobUrl(input.url);
  if (url) return `u:${url}`;
  return `cr:${normText(input.company)}|${normText(input.role)}`;
}
