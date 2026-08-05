/** Plain text from HTML / entities for card + scoring display */

export function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) =>
      String.fromCharCode(parseInt(h, 16)),
    );
}

export function stripHtml(raw: string): string {
  const decoded = decodeEntities(raw || "");
  return decoded
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function previewText(raw: string, max = 220): string {
  const t = stripHtml(raw);
  if (t.length <= max) return t;
  return `${t.slice(0, max).trim()}…`;
}

/**
 * Break job description walls into readable paragraphs.
 * Uses blank lines when present; otherwise packs sentences into short blocks.
 */
export function descriptionParagraphs(raw: string): string[] {
  const text = stripHtml(raw)
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (!text) return [];

  let parts = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  // Single long blob (typical after HTML strip / translate) → sentence packs
  if (parts.length === 1 && (parts[0]?.length ?? 0) > 260) {
    const sentences = parts[0]!.split(
      /(?<=[.!?…])\s+(?=[A-ZА-ЯЁІЇЄҐÜÖÄ0-9«"„])/u,
    ).filter((s) => s.trim());
    const chunks: string[] = [];
    let buf = "";
    for (const s of sentences) {
      const next = buf ? `${buf} ${s}` : s;
      if (next.length > 300 && buf) {
        chunks.push(buf.trim());
        buf = s;
      } else {
        buf = next;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());
    if (chunks.length > 1) parts = chunks;
  }

  // Soft-split remaining monsters
  const out: string[] = [];
  for (const p of parts) {
    if (p.length <= 520) {
      out.push(p);
      continue;
    }
    let rest = p;
    while (rest.length > 520) {
      let cut = rest.lastIndexOf(". ", 480);
      if (cut < 200) cut = rest.lastIndexOf(" ", 480);
      if (cut < 120) cut = 480;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
  }
  return out.length ? out : [text];
}

/** Infer schedule / work mode chips from job fields + description */
export function scheduleChips(job: {
  remote: boolean | null;
  location: string | null;
  description: string;
}): string[] {
  const blob = `${job.location || ""} ${job.description}`.toLowerCase();
  const out: string[] = [];
  if (job.remote === true || /\b(remote|distributed|work from home|wfh)\b/.test(blob)) {
    out.push("Remote");
  } else if (/\bhybrid\b/.test(blob)) {
    out.push("Hybrid");
  } else if (/\bon[-\s]?site|in[-\s]?office\b/.test(blob)) {
    out.push("On-site");
  }
  if (/\bfull[-\s]?time\b/.test(blob)) out.push("Full-time");
  else if (/\bpart[-\s]?time\b/.test(blob)) out.push("Part-time");
  if (/\b(contract|contractor|freelance)\b/.test(blob)) out.push("Contract");
  if (/\bintern(ship)?\b/.test(blob)) out.push("Intern");
  return [...new Set(out)];
}

export function salaryLabel(salary: {
  min: number | null;
  max: number | null;
  currency: string;
  period: string;
} | null): string {
  if (!salary || (salary.min == null && salary.max == null)) return "Comp TBD";
  const unit =
    salary.period === "hour" ? "/h" : salary.period === "month" ? "/mo" : "/yr";
  const fmt = (n: number) => {
    if (salary.period === "hour") return `${salary.currency} ${n}${unit}`;
    if (n >= 1000) return `${salary.currency} ${Math.round(n / 1000)}k${unit}`;
    return `${salary.currency} ${n}${unit}`;
  };
  if (salary.min != null && salary.max != null)
    return `${fmt(salary.min)}–${fmt(salary.max)}`;
  if (salary.min != null) return `from ${fmt(salary.min)}`;
  return `up to ${fmt(salary.max!)}`;
}
