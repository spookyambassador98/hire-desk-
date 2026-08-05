import type { FollowUpInfo, Job } from "./types";
import { pickFollowUpTemplate, type TemplateId } from "./templates";

export function silentDaysSince(
  iso: string | null | undefined,
  nowMs = Date.now(),
): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return Math.floor((nowMs - t) / (1000 * 60 * 60 * 24));
}

/**
 * Follow-up due if applied/follow_up and silent ≥ 3/7/14 days
 * since appliedAt (or last followUpAt if set).
 */
export function getFollowUpInfo(
  job: Job,
  nowMs = Date.now(),
): FollowUpInfo {
  if (!["applied", "follow_up"].includes(job.status) || !job.appliedAt) {
    return { silentDays: 0, stage: null, due: false, label: "—" };
  }

  const anchor = job.followUpAt || job.appliedAt;
  const silentDays = silentDaysSince(anchor, nowMs);
  const template = pickFollowUpTemplate(silentDays);
  if (!template) {
    return {
      silentDays,
      stage: null,
      due: false,
      label: `Day ${silentDays} · wait`,
    };
  }

  const stage = template === "followup_d14" ? 14 : template === "followup_d7" ? 7 : 3;
  return {
    silentDays,
    stage,
    due: true,
    label: `Follow-up D${stage} · ${silentDays}d silent`,
  };
}

export function followUpTemplateForJob(job: Job): TemplateId | null {
  const info = getFollowUpInfo(job);
  if (!info.due || !info.stage) return null;
  return pickFollowUpTemplate(info.silentDays);
}

export function sortAppliedWithFollowUps<T extends Job>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const fa = getFollowUpInfo(a);
    const fb = getFollowUpInfo(b);
    if (fa.due !== fb.due) return fa.due ? -1 : 1;
    if (fa.due && fb.due) return fb.silentDays - fa.silentDays;
    return (b.appliedAt || "").localeCompare(a.appliedAt || "");
  });
}
