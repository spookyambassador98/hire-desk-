import { getProject, matchPortfolio } from "./portfolio";
import type { Individual, Job, PortfolioProjectId, Region } from "./types";
import { enrichIndividual } from "./individualScoring";

/**
 * Apply / follow-up / interview templates.
 * Slots: {{role}} {{company}} {{proof1}} {{proof1_url}} {{proof2}} {{proof2_url}} {{why_fit}} {{sticky}}
 */

export const STICKY_PITCH =
  "I don’t come from a classical CS path. I ship end-to-end digital products with AI-native workflows — from industrial portals and trading-school platforms to realtime 3D ops consoles. You give the problem; I deliver the product.";

export type TemplateId =
  | "apply_europe"
  | "apply_america"
  | "followup_d3"
  | "followup_d7"
  | "followup_d14"
  | "interview_brief"
  | "ind_europe"
  | "ind_america"
  | "ind_followup";

export type TemplateDef = {
  id: TemplateId;
  name: string;
  region?: Region | "any";
  body: string;
  kind?: "job" | "individual";
};

export const TEMPLATES: TemplateDef[] = [
  {
    id: "apply_europe",
    name: "Apply · Europe",
    region: "europe",
    body: `Dear {{company}} hiring team,

I am applying for the {{role}} role.

{{sticky}}

Relevant proof:
• {{proof1}}{{proof1_url_line}}
{{proof2_block}}

{{why_fit}}

Happy to walk through a short demo or a relevant build on a call.

Kind regards`,
  },
  {
    id: "apply_america",
    name: "Apply · America",
    region: "america",
    body: `Hi {{company}} team —

Applying for {{role}}.

{{sticky}}

Proof I’ll lead with:
• {{proof1}}{{proof1_url_line}}
{{proof2_block}}

{{why_fit}}

If useful, I can share a 5-min walkthrough of the closest demo.

Thanks,
Ready when you are.`,
  },
  {
    id: "followup_d3",
    name: "Follow-up · Day 3",
    region: "any",
    body: `Hi — quick bump on my application for {{role}} at {{company}}.

Still interested. Happy to send a tighter one-pager or a demo link ({{proof1}}) if that helps.

Thanks`,
  },
  {
    id: "followup_d7",
    name: "Follow-up · Day 7",
    region: "any",
    body: `Hi {{company}} —

Following up on {{role}} (applied ~a week ago).

In case context helps: {{proof1}} is the closest shipped analog to what you’re hiring for{{proof1_url_line}}.

Open to a short screen-share if you’re still interviewing.

Best`,
  },
  {
    id: "followup_d14",
    name: "Follow-up · Day 14",
    region: "any",
    body: `Hi — last soft check-in on {{role}} at {{company}}.

If the role is filled or paused, no worries — appreciate a quick note either way so I can close the loop.

If it’s still open, I’m available this week for a conversation.

Thank you`,
  },
  {
    id: "interview_brief",
    name: "Interview brief",
    region: "any",
    body: `## Interview brief — {{role}} @ {{company}}

1. Sticky: product builder, not classical CS — ship end-to-end with AI-native workflows.
2. Primary proof: {{proof1}}{{proof1_url_line}}
3. Secondary / angle: {{proof2_or_fallback}}

### Open in interview
{{demo_list}}

### Why this role
{{why_fit}}`,
  },
  {
    id: "ind_europe",
    name: "Individual · Europe",
    region: "europe",
    kind: "individual",
    body: `Dear {{name}},

I came across your work at {{company}}{{target_role_line}} and wanted to reach you directly rather than only through the public posting.

{{sticky}}

Closest proof:
• {{proof1}}{{proof1_url_line}}
{{proof2_block}}

{{why_fit}}

If useful, I can send a short walkthrough of the demo.

Kind regards`,
  },
  {
    id: "ind_america",
    name: "Individual · America",
    region: "america",
    kind: "individual",
    body: `Hi {{name}} —

Writing you directly (not just the ATS) about {{company}}{{target_role_line}}.

{{sticky}}

Proof I’ll lead with:
• {{proof1}}{{proof1_url_line}}
{{proof2_block}}

{{why_fit}}

Happy to do a 5-min screen-share if you’re the right person — or point me to who is.

Thanks`,
  },
  {
    id: "ind_followup",
    name: "Individual · Follow-up",
    region: "any",
    kind: "individual",
    body: `Hi {{name}} — quick bump on my note about {{company}}{{target_role_line}}.

Still keen. Demo if useful: {{proof1}}{{proof1_url_line}}.

Appreciate any pointer either way.

Thanks`,
  },
];

export type TemplateSlots = {
  role: string;
  company: string;
  proof1: string;
  proof1_url: string;
  proof2: string;
  proof2_url: string;
  why_fit: string;
  sticky: string;
  name: string;
  target_role: string;
};

function proofLine(name: string, url: string | null): {
  name: string;
  url: string;
  urlLine: string;
} {
  const u = url?.trim() || "";
  return {
    name,
    url: u,
    urlLine: u ? ` — ${u}` : "",
  };
}

export function slotsFromJob(job: Job): TemplateSlots {
  const matched =
    job.proofProjects?.length && job.whyFit
      ? {
          proofs: job.proofProjects,
          whyFit: job.whyFit,
        }
      : matchPortfolio(job);

  const p1 = matched.proofs[0];
  const p2 = matched.proofs[1];

  const primary = p1
    ? proofLine(p1.name, p1.demoUrl)
    : proofLine(getProject("asema").name, getProject("asema").demoUrl);

  const secondary = p2
    ? proofLine(p2.name, p2.demoUrl)
    : { name: "", url: "", urlLine: "" };

  return {
    role: job.role,
    company: job.company,
    proof1: primary.name,
    proof1_url: primary.url,
    proof2: secondary.name,
    proof2_url: secondary.url,
    why_fit: matched.whyFit || job.whyFit || "",
    sticky: STICKY_PITCH,
    name: "",
    target_role: job.role,
  };
}

export function slotsFromIndividual(ind: Individual): TemplateSlots {
  const row = enrichIndividual(ind);
  const matched =
    row.proofProjects?.length && row.whyFit
      ? { proofs: row.proofProjects, whyFit: row.whyFit }
      : matchPortfolio({
          role: row.targetRole || row.title || row.kind,
          company: row.company,
          description: `${row.targetRole || ""} ${row.notes || ""}`,
        });

  const p1 = matched.proofs[0];
  const p2 = matched.proofs[1];
  const primary = p1
    ? proofLine(p1.name, p1.demoUrl)
    : proofLine(getProject("asema").name, getProject("asema").demoUrl);
  const secondary = p2
    ? proofLine(p2.name, p2.demoUrl)
    : { name: "", url: "", urlLine: "" };

  return {
    role: row.targetRole || row.title || row.kind,
    company: row.company,
    proof1: primary.name,
    proof1_url: primary.url,
    proof2: secondary.name,
    proof2_url: secondary.url,
    why_fit: matched.whyFit || row.whyFit || "",
    sticky: STICKY_PITCH,
    name: row.name,
    target_role: row.targetRole || "",
  };
}

function fillDerived(slots: TemplateSlots): Record<string, string> {
  const proof2_block = slots.proof2
    ? `• ${slots.proof2}${slots.proof2_url ? ` — ${slots.proof2_url}` : ""}`
    : "";

  const proof2_or_fallback = slots.proof2
    ? `${slots.proof2}${slots.proof2_url ? ` — ${slots.proof2_url}` : ""}`
    : "General fullstack + product packaging (Asema / APEX) if they ask for breadth.";

  const demos = [slots.proof1_url, slots.proof2_url].filter(Boolean);
  const demo_list =
    demos.length > 0
      ? demos.map((u, i) => `${i + 1}. ${u}`).join("\n")
      : "1. https://demo-trading-one.vercel.app/\n2. https://demo-cosmo.vercel.app/";

  const target_role_line = slots.target_role
    ? ` / ${slots.target_role}`
    : "";

  return {
    ...slots,
    proof1_url_line: slots.proof1_url ? ` — ${slots.proof1_url}` : "",
    proof2_block,
    proof2_or_fallback,
    demo_list,
    target_role_line,
  };
}

function renderBody(
  templateId: TemplateId,
  slots: TemplateSlots,
  overrides?: Partial<TemplateSlots>,
): string {
  const def = TEMPLATES.find((t) => t.id === templateId);
  if (!def) throw new Error(`Unknown template: ${templateId}`);
  const all = fillDerived({ ...slots, ...overrides });
  return def.body.replace(/\{\{(\w+)\}\}/g, (_, key: string) => all[key] ?? "");
}

export function renderTemplate(
  templateId: TemplateId,
  job: Job,
  overrides?: Partial<TemplateSlots>,
): string {
  return renderBody(templateId, slotsFromJob(job), overrides);
}

export function renderIndividualTemplate(
  templateId: TemplateId,
  ind: Individual,
  overrides?: Partial<TemplateSlots>,
): string {
  return renderBody(templateId, slotsFromIndividual(ind), overrides);
}

export function pickApplyTemplate(region: Region): TemplateId {
  return region === "europe" ? "apply_europe" : "apply_america";
}

export function pickIndividualTemplate(region: Region): TemplateId {
  return region === "europe" ? "ind_europe" : "ind_america";
}

export function renderApply(job: Job): string {
  return renderTemplate(pickApplyTemplate(job.region), job);
}

export function renderIndividualEmail(ind: Individual): string {
  return renderIndividualTemplate(pickIndividualTemplate(ind.region), ind);
}

/** Follow-up by silent days since applied */
export function pickFollowUpTemplate(
  silentDays: number,
): TemplateId | null {
  if (silentDays >= 14) return "followup_d14";
  if (silentDays >= 7) return "followup_d7";
  if (silentDays >= 3) return "followup_d3";
  return null;
}

export function projectMention(id: PortfolioProjectId): string {
  const p = getProject(id);
  return p.demoUrl ? `${p.name} (${p.demoUrl})` : p.name;
}
