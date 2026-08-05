import type { IndividualKind, Job, Region } from "@/lib/types";

export type ExtractedContact = {
  name: string;
  kind: IndividualKind;
  title: string | null;
  email: string | null;
  linkedin: string | null;
  company: string;
  region: Region;
  targetRole: string | null;
  notes: string;
};

const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const KIND_HINTS: Array<{ re: RegExp; kind: IndividualKind; title: string }> = [
  { re: /\bhiring\s+manager\b/i, kind: "hiring_manager", title: "Hiring Manager" },
  { re: /\btechnical\s+recruiter\b/i, kind: "recruiter", title: "Technical Recruiter" },
  { re: /\brecruiter\b/i, kind: "recruiter", title: "Recruiter" },
  { re: /\btalent\s+(acquisition|partner)\b/i, kind: "recruiter", title: "Talent" },
  { re: /\bhead\s+of\s+(people|talent|hr)\b/i, kind: "hr", title: "Head of People" },
  { re: /\bhr\s+(manager|business\s+partner)\b/i, kind: "hr", title: "HR" },
  { re: /\bfounder\b|\bco[-\s]?founder\b/i, kind: "founder", title: "Founder" },
  { re: /\bstaff\s+engineer\b|\bprincipal\s+engineer\b/i, kind: "senior_eng", title: "Staff Engineer" },
];

function guessKind(blob: string): { kind: IndividualKind; title: string | null } {
  for (const h of KIND_HINTS) {
    if (h.re.test(blob)) return { kind: h.kind, title: h.title };
  }
  return { kind: "other", title: null };
}

function nameFromEmail(email: string): string {
  const local = email.split("@")[0] || "contact";
  return local
    .replace(/[._+-]+/g, " ")
    .replace(/\d+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 60) || "Contact";
}

/** Pull HR / recruiter emails + job.contact into Individual drafts. */
export function extractContactsFromJob(job: Job): ExtractedContact[] {
  const out: ExtractedContact[] = [];
  const seen = new Set<string>();

  const push = (c: ExtractedContact) => {
    const key = (c.email || c.linkedin || c.name).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  if (job.contact?.name || job.contact?.handle) {
    const handle = job.contact.handle || null;
    const isEmail = handle && handle.includes("@");
    const isLi =
      handle &&
      (/linkedin\.com/i.test(handle) || handle.startsWith("http"));
    const { kind, title } = guessKind(
      `${job.contact.role || ""} ${job.contact.channel || ""}`,
    );
    push({
      name: job.contact.name || (isEmail ? nameFromEmail(handle!) : "Contact"),
      kind: kind === "other" && job.contact.role ? "hiring_manager" : kind,
      title: job.contact.role || title,
      email: isEmail ? handle : null,
      linkedin: isLi
        ? handle!.startsWith("http")
          ? handle
          : `https://linkedin.com/in/${handle}`
        : null,
      company: job.company,
      region: job.region,
      targetRole: job.role,
      notes: `From job contact · ${job.role}`,
    });
  }

  const text = job.description || "";
  const emails = text.match(EMAIL_RE) || [];
  for (const email of emails.slice(0, 3)) {
    if (/noreply|no-reply|donotreply|example\.com|sentry|github/i.test(email))
      continue;
    const idx = text.toLowerCase().indexOf(email.toLowerCase());
    const ctx = text.slice(Math.max(0, idx - 80), idx + email.length + 40);
    const { kind, title } = guessKind(ctx);
    push({
      name: nameFromEmail(email),
      kind,
      title,
      email: email.toLowerCase(),
      linkedin: null,
      company: job.company,
      region: job.region,
      targetRole: job.role,
      notes: `Extracted from posting · ${job.role}`,
    });
  }

  return out;
}
