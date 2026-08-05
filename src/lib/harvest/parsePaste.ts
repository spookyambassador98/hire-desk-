import { randomUUID } from "node:crypto";
import { enrichJobProofs } from "../scoring";
import type { ApplyChannel, Job, Region } from "../types";

export type HarvestResult = {
  added: number;
  skipped: number;
  errors: string[];
  jobs: Job[];
};

function inferChannel(url: string | null | undefined): ApplyChannel {
  if (!url) return "none";
  const u = url.toLowerCase();
  if (u.includes("ashbyhq.com") || u.includes("jobs.ashby")) return "ashby";
  if (u.includes("greenhouse")) return "greenhouse";
  if (u.includes("lever.co")) return "lever";
  if (u.includes("linkedin.com")) return "linkedin";
  if (u.includes("wellfound.com") || u.includes("angel.co")) return "wellfound";
  return "other";
}

function inferRegion(raw: string | undefined | null): Region {
  const t = (raw || "").toLowerCase();
  if (
    /singapore|tokyo|japan|korea|hong\s*kong|india|bangalore|apac|asia/.test(t)
  ) {
    return "asia";
  }
  if (
    /america|usa|us\b|united states|canada|latam|nyc|sf\b|remote us/.test(t)
  ) {
    return "america";
  }
  return "europe";
}

type LooseJob = {
  id?: string;
  company?: string;
  role?: string;
  title?: string;
  region?: string;
  description?: string;
  url?: string;
  link?: string;
  location?: string;
  remote?: boolean | null;
  salary?: Job["salary"];
  channel?: ApplyChannel;
  contact?: Job["contact"];
  notes?: string | null;
  source?: string | null;
};

function normalizeOne(raw: LooseJob, now: string): Job | null {
  const company = (raw.company || "").trim();
  const role = (raw.role || raw.title || "").trim();
  const description = (raw.description || "").trim();
  if (!company || !role) return null;

  const url = (raw.url || raw.link || null)?.toString().trim() || null;
  const region =
    raw.region === "america" ||
    raw.region === "europe" ||
    raw.region === "asia"
      ? raw.region
      : inferRegion(`${raw.region || ""} ${raw.location || ""}`);

  return enrichJobProofs({
    id: raw.id || `job_${randomUUID().slice(0, 8)}`,
    company,
    role,
    region,
    location: raw.location ?? null,
    remote: raw.remote ?? null,
    description: description || `${role} at ${company}`,
    salary: raw.salary ?? null,
    url,
    channel: raw.channel || inferChannel(url),
    contact: raw.contact ?? null,
    status: "new",
    notes: raw.notes ?? null,
    source: raw.source || "harvest",
    appliedAt: null,
    followUpAt: null,
    postedAt: now,
    createdAt: now,
    updatedAt: now,
  });
}

/** Parse JSON array, single object, or NDJSON lines into Job drafts */
export function parseHarvestPayload(text: string): {
  jobs: Job[];
  errors: string[];
} {
  const errors: string[] = [];
  const now = new Date().toISOString();
  const trimmed = text.trim();
  if (!trimmed) return { jobs: [], errors: ["empty_payload"] };

  const out: Job[] = [];

  const pushLoose = (row: LooseJob, idx: number) => {
    const job = normalizeOne(row, now);
    if (!job) {
      errors.push(`row_${idx}: need company + role`);
      return;
    }
    out.push(job);
  };

  // CSV: company,role,region,url,description
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && trimmed.includes(",")) {
    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    const start = /company/i.test(lines[0]) ? 1 : 0;
    for (let i = start; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      pushLoose(
        {
          company: cols[0],
          role: cols[1],
          region: cols[2],
          url: cols[3],
          description: cols[4] || cols[1],
        },
        i,
      );
    }
    return { jobs: out, errors };
  }

  try {
    if (trimmed.startsWith("[")) {
      const arr = JSON.parse(trimmed) as LooseJob[];
      arr.forEach((row, i) => pushLoose(row, i));
      return { jobs: out, errors };
    }
    if (trimmed.startsWith("{")) {
      pushLoose(JSON.parse(trimmed) as LooseJob, 0);
      return { jobs: out, errors };
    }
  } catch {
    // fall through to NDJSON
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  lines.forEach((line, i) => {
    try {
      pushLoose(JSON.parse(line) as LooseJob, i);
    } catch {
      errors.push(`line_${i}: invalid_json`);
    }
  });

  return { jobs: out, errors };
}
