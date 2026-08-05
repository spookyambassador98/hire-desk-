import { randomUUID } from "node:crypto";
import {
  readRawIndividuals,
  readRawJobs,
  writeRawIndividuals,
  writeRawJobs,
} from "./persistence";
import {
  enrichIndividual,
  scoreIndividual,
} from "./individualScoring";
import { enrichJobProofs, scoreJob } from "./scoring";
import { resolveSalary } from "./regions";
import type {
  ApplyChannel,
  HireProfile,
  Individual,
  IndividualKind,
  IndividualStatus,
  Job,
  JobStatus,
  PriorityContext,
  QuotaSnapshot,
  Region,
  ScoredIndividual,
  ScoredJob,
} from "./types";
import { DEFAULT_HIRE_PROFILE } from "./types";
import { extractContactsFromJob } from "./extractContacts";
import { stripHtml } from "./text";
import { parseHarvestPayload } from "./harvest/parsePaste";
import { jobDedupeKey } from "./harvest/dedupe";

function startOfUtcDay(iso = new Date().toISOString()): string {
  return iso.slice(0, 10);
}

export function appliedTodayCounts(jobs: Job[], day = startOfUtcDay()) {
  let europe = 0;
  let america = 0;
  let asia = 0;
  for (const j of jobs) {
    if (!j.appliedAt?.startsWith(day)) continue;
    if (j.region === "europe") europe += 1;
    else if (j.region === "asia") asia += 1;
    else america += 1;
  }
  return { europe, america, asia };
}

export function emailedTodayCount(
  individuals: Individual[],
  day = startOfUtcDay(),
) {
  return individuals.filter((i) => i.emailedAt?.startsWith(day)).length;
}

export function buildPriorityContext(
  jobs: Job[],
  profile: HireProfile = DEFAULT_HIRE_PROFILE,
  individuals: Individual[] = [],
): PriorityContext & { individualQuotaRemaining: number } {
  const counts = appliedTodayCounts(jobs);
  const emailed = emailedTodayCount(individuals);
  return {
    europeQuotaRemaining: Math.max(
      0,
      profile.europeDailyQuota - counts.europe,
    ),
    americaQuotaRemaining: Math.max(
      0,
      profile.americaDailyQuota - counts.america,
    ),
    asiaQuotaRemaining: Math.max(0, profile.asiaDailyQuota - counts.asia),
    individualQuotaRemaining: Math.max(
      0,
      profile.individualDailyQuota - emailed,
    ),
  };
}

export function withScores(
  jobs: Job[],
  profile: HireProfile = DEFAULT_HIRE_PROFILE,
  individuals: Individual[] = [],
): ScoredJob[] {
  const ctx = buildPriorityContext(jobs, profile, individuals);
  return jobs
    .map((j) => {
      const description = stripHtml(j.description || "");
      const salary =
        j.salary && (j.salary.min != null || j.salary.max != null)
          ? j.salary
          : resolveSalary({
              min: null,
              max: null,
              currency: null,
              description,
              region: j.region,
            });
      const job = enrichJobProofs({
        ...j,
        description,
        salary,
        postedAt: j.postedAt ?? null,
      });
      return { ...job, scores: scoreJob(job, ctx, profile) };
    })
    .sort(
      (a, b) =>
        b.scores.priority.score - a.scores.priority.score ||
        b.scores.fit.score - a.scores.fit.score ||
        // fresher first as tie-break
        Date.parse(b.postedAt || b.createdAt) -
          Date.parse(a.postedAt || a.createdAt),
    );
}

export function withIndividualScores(
  rows: Individual[],
  jobs: Job[] = [],
  profile: HireProfile = DEFAULT_HIRE_PROFILE,
): ScoredIndividual[] {
  const ctx = buildPriorityContext(jobs, profile, rows);
  return rows
    .map((r) => {
      const ind = enrichIndividual(r);
      return { ...ind, scores: scoreIndividual(ind, ctx) };
    })
    .sort((a, b) => b.scores.priority.score - a.scores.priority.score);
}

export async function readJobs(): Promise<Job[]> {
  return readRawJobs();
}

export async function readScoredJobs(
  profile: HireProfile = DEFAULT_HIRE_PROFILE,
): Promise<ScoredJob[]> {
  const jobs = await readJobs();
  const individuals = await readRawIndividuals();
  return withScores(jobs, profile, individuals);
}

export async function readIndividuals(): Promise<Individual[]> {
  return readRawIndividuals();
}

export async function readScoredIndividuals(
  profile: HireProfile = DEFAULT_HIRE_PROFILE,
): Promise<ScoredIndividual[]> {
  const rows = await readIndividuals();
  const jobs = await readRawJobs();
  return withIndividualScores(rows, jobs, profile);
}

export type CreateJobInput = {
  company: string;
  role: string;
  region: Region;
  location?: string | null;
  remote?: boolean | null;
  description: string;
  salary?: Job["salary"];
  url?: string | null;
  channel?: ApplyChannel;
  contact?: Job["contact"];
  notes?: string | null;
  source?: string | null;
};

export async function createJob(input: CreateJobInput): Promise<Job> {
  const jobs = await readRawJobs();
  const now = new Date().toISOString();
  const job = enrichJobProofs({
    id: `job_${randomUUID().slice(0, 8)}`,
    company: input.company.trim(),
    role: input.role.trim(),
    region: input.region,
    location: input.location ?? null,
    remote: input.remote ?? null,
    description: stripHtml(input.description).trim(),
    salary: input.salary ?? null,
    url: input.url?.trim() || null,
    channel: input.channel ?? (input.url ? "other" : "none"),
    contact: input.contact ?? null,
    status: "new",
    notes: input.notes ?? null,
    source: input.source ?? "manual",
    appliedAt: null,
    followUpAt: null,
    postedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  jobs.unshift(job);
  await writeRawJobs(jobs);
  return job;
}

export type PatchJobInput = {
  status?: JobStatus;
  notes?: string | null;
  followUpAt?: string | null;
  url?: string | null;
  channel?: ApplyChannel;
  contact?: Job["contact"];
  region?: Region;
  description?: string;
  salary?: Job["salary"];
};

export async function patchJob(
  id: string,
  patch: PatchJobInput,
): Promise<Job | null> {
  const jobs = await readRawJobs();
  const idx = jobs.findIndex((j) => j.id === id);
  if (idx < 0) return null;

  const prev = jobs[idx];
  const now = new Date().toISOString();
  let appliedAt = prev.appliedAt;
  let followUpAt = patch.followUpAt !== undefined ? patch.followUpAt : prev.followUpAt;

  if (patch.status === "applied" && prev.status !== "applied") {
    appliedAt = now;
  }
  if (patch.status === "follow_up") {
    followUpAt = now;
  }

  const next = enrichJobProofs({
    ...prev,
    ...patch,
    appliedAt,
    followUpAt,
    updatedAt: now,
  });
  jobs[idx] = next;
  await writeRawJobs(jobs);
  return next;
}

export async function deleteJob(id: string): Promise<boolean> {
  const jobs = await readRawJobs();
  const next = jobs.filter((j) => j.id !== id);
  if (next.length === jobs.length) return false;
  await writeRawJobs(next);
  return true;
}

export type CreateIndividualInput = {
  name: string;
  kind: IndividualKind;
  title?: string | null;
  company: string;
  region: Region;
  email?: string | null;
  linkedin?: string | null;
  linkedJobId?: string | null;
  targetRole?: string | null;
  notes?: string | null;
  source?: string | null;
};

export async function createIndividual(
  input: CreateIndividualInput,
): Promise<Individual> {
  const rows = await readRawIndividuals();
  const now = new Date().toISOString();
  const row = enrichIndividual({
    id: `ind_${randomUUID().slice(0, 8)}`,
    name: input.name.trim(),
    kind: input.kind,
    title: input.title?.trim() || null,
    company: input.company.trim(),
    region: input.region,
    email: input.email?.trim() || null,
    linkedin: input.linkedin?.trim() || null,
    linkedJobId: input.linkedJobId || null,
    targetRole: input.targetRole?.trim() || null,
    notes: input.notes ?? null,
    status: "new",
    source: input.source ?? "manual",
    emailedAt: null,
    followUpAt: null,
    createdAt: now,
    updatedAt: now,
  });
  rows.unshift(row);
  await writeRawIndividuals(rows);
  return row;
}

export type PatchIndividualInput = {
  status?: IndividualStatus;
  notes?: string | null;
  email?: string | null;
  linkedin?: string | null;
  linkedJobId?: string | null;
  targetRole?: string | null;
  title?: string | null;
  kind?: IndividualKind;
};

export async function patchIndividual(
  id: string,
  patch: PatchIndividualInput,
): Promise<Individual | null> {
  const rows = await readRawIndividuals();
  const idx = rows.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const prev = rows[idx];
  const now = new Date().toISOString();
  let emailedAt = prev.emailedAt;
  let followUpAt = prev.followUpAt;

  if (patch.status === "emailed" && prev.status !== "emailed") {
    emailedAt = now;
  }
  if (patch.status === "emailed" && prev.status === "emailed") {
    followUpAt = now;
  }

  const next = enrichIndividual({
    ...prev,
    ...patch,
    emailedAt,
    followUpAt,
    updatedAt: now,
  });
  rows[idx] = next;
  await writeRawIndividuals(rows);
  return next;
}

export async function deleteIndividual(id: string): Promise<boolean> {
  const rows = await readRawIndividuals();
  const next = rows.filter((r) => r.id !== id);
  if (next.length === rows.length) return false;
  await writeRawIndividuals(next);
  return true;
}

/** Import jobs from harvest payload; dedupe by normalized URL / company+role */
export async function importHarvestJobs(text: string) {
  const { jobs: parsed, errors } = parseHarvestPayload(text);
  const existing = await readRawJobs();
  const seen = new Set(existing.map(jobDedupeKey));
  let added = 0;
  let skipped = 0;
  for (const job of parsed) {
    if (seen.has(jobDedupeKey(job))) {
      skipped += 1;
      continue;
    }
    existing.unshift({ ...job, description: stripHtml(job.description) });
    seen.add(jobDedupeKey(job));
    added += 1;
  }
  await writeRawJobs(existing);
  return { added, skipped, errors, total: existing.length };
}

/** Append already-normalized jobs (MAX LIVE batches). */
export async function ingestJobsBatch(jobs: Job[]) {
  if (!jobs.length) return { added: 0, individualsAdded: 0 };
  const cleaned = jobs.map((j) => ({
    ...j,
    description: stripHtml(j.description),
  }));
  const existing = await readRawJobs();
  const seen = new Set(existing.map(jobDedupeKey));
  let added = 0;
  const fresh: Job[] = [];
  for (const job of cleaned) {
    if (seen.has(jobDedupeKey(job))) continue;
    existing.unshift(job);
    seen.add(jobDedupeKey(job));
    fresh.push(job);
    added += 1;
  }
  await writeRawJobs(existing);

  let individualsAdded = 0;
  if (fresh.length) {
    const indRows = await readRawIndividuals();
    const emailSeen = new Set(
      indRows
        .map((i) => (i.email || "").toLowerCase())
        .filter(Boolean),
    );
    const nameCoSeen = new Set(
      indRows.map(
        (i) => `${i.name.toLowerCase()}|${i.company.toLowerCase()}`,
      ),
    );
    const now = new Date().toISOString();
    for (const job of fresh) {
      for (const c of extractContactsFromJob(job)) {
        if (c.email && emailSeen.has(c.email.toLowerCase())) continue;
        const nk = `${c.name.toLowerCase()}|${c.company.toLowerCase()}`;
        if (nameCoSeen.has(nk) && !c.email) continue;
        const row = enrichIndividual({
          id: `ind_${randomUUID().slice(0, 8)}`,
          name: c.name,
          kind: c.kind,
          title: c.title,
          company: c.company,
          region: c.region,
          email: c.email,
          linkedin: c.linkedin,
          linkedJobId: job.id,
          targetRole: c.targetRole,
          notes: c.notes,
          status: "new",
          source: `extract:${job.source || "job"}`,
          emailedAt: null,
          followUpAt: null,
          createdAt: now,
          updatedAt: now,
        });
        indRows.unshift(row);
        if (c.email) emailSeen.add(c.email.toLowerCase());
        nameCoSeen.add(nk);
        individualsAdded += 1;
      }
    }
    if (individualsAdded) await writeRawIndividuals(indRows);
  }

  return { added, individualsAdded };
}

export function quotaSnapshot(
  jobs: Job[],
  individuals: Individual[] = [],
  profile: HireProfile = DEFAULT_HIRE_PROFILE,
): QuotaSnapshot {
  const counts = appliedTodayCounts(jobs);
  const emailed = emailedTodayCount(individuals);
  return {
    europe: {
      used: counts.europe,
      quota: profile.europeDailyQuota,
      remaining: Math.max(0, profile.europeDailyQuota - counts.europe),
    },
    america: {
      used: counts.america,
      quota: profile.americaDailyQuota,
      remaining: Math.max(0, profile.americaDailyQuota - counts.america),
    },
    asia: {
      used: counts.asia,
      quota: profile.asiaDailyQuota,
      remaining: Math.max(0, profile.asiaDailyQuota - counts.asia),
    },
    individuals: {
      used: emailed,
      quota: profile.individualDailyQuota,
      remaining: Math.max(0, profile.individualDailyQuota - emailed),
    },
  };
}

export async function deskPayload(
  profile: HireProfile = DEFAULT_HIRE_PROFILE,
) {
  const jobsRaw = await readJobs();
  await backfillIndividualsFromJobs(jobsRaw);
  const indRaw = await readIndividuals();
  return {
    jobs: withScores(jobsRaw, profile, indRaw),
    individuals: withIndividualScores(indRaw, jobsRaw, profile),
    quota: quotaSnapshot(jobsRaw, indRaw, profile),
    profile,
  };
}

/** One-shot extract contacts from jobs already in DB (no fake seed). */
async function backfillIndividualsFromJobs(jobs: Job[]) {
  if (!jobs.length) return;
  const indRows = await readRawIndividuals();
  const before = indRows.length;
  const emailSeen = new Set(
    indRows.map((i) => (i.email || "").toLowerCase()).filter(Boolean),
  );
  const nameCoSeen = new Set(
    indRows.map((i) => `${i.name.toLowerCase()}|${i.company.toLowerCase()}`),
  );
  const now = new Date().toISOString();
  for (const job of jobs) {
    for (const c of extractContactsFromJob(job)) {
      if (c.email && emailSeen.has(c.email.toLowerCase())) continue;
      const nk = `${c.name.toLowerCase()}|${c.company.toLowerCase()}`;
      if (nameCoSeen.has(nk) && !c.email) continue;
      // Prefer contacts that give an email or linkedin — skip nameless noise
      if (!c.email && !c.linkedin && c.kind === "other") continue;
      indRows.unshift(
        enrichIndividual({
          id: `ind_${randomUUID().slice(0, 8)}`,
          name: c.name,
          kind: c.kind,
          title: c.title,
          company: c.company,
          region: c.region,
          email: c.email,
          linkedin: c.linkedin,
          linkedJobId: job.id,
          targetRole: c.targetRole,
          notes: c.notes,
          status: "new",
          source: `backfill:${job.source || "job"}`,
          emailedAt: null,
          followUpAt: null,
          createdAt: now,
          updatedAt: now,
        }),
      );
      if (c.email) emailSeen.add(c.email.toLowerCase());
      nameCoSeen.add(nk);
    }
  }
  if (indRows.length > before) await writeRawIndividuals(indRows);
}
