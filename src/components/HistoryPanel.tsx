"use client";

import { useMemo } from "react";
import type { HireActivity } from "@/lib/activity";
import type { ScoredIndividual, ScoredJob } from "@/lib/types";

type Props = {
  activities: HireActivity[];
  jobs: ScoredJob[];
  individuals: ScoredIndividual[];
};

function dayKey(iso: string) {
  return iso.slice(0, 10);
}

export function HistoryPanel({ activities, jobs, individuals }: Props) {
  const byDay = useMemo(() => {
    const map = new Map<string, HireActivity[]>();
    for (const a of activities) {
      const k = dayKey(a.createdAt);
      const row = map.get(k) || [];
      row.push(a);
      map.set(k, row);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [activities]);

  const applied7 = jobs.filter(
    (j) => j.appliedAt && Date.now() - new Date(j.appliedAt).getTime() < 7 * 864e5,
  ).length;
  const emailed7 = individuals.filter(
    (i) => i.emailedAt && Date.now() - new Date(i.emailedAt).getTime() < 7 * 864e5,
  ).length;

  return (
    <div className="hd-panel">
      <div className="hd-rail eu" style={{ marginBottom: "1rem" }}>
        <h2>History · 7 days</h2>
        <p>
          Applied {applied7} · individuals emailed {emailed7} · events{" "}
          {activities.length}
        </p>
      </div>

      <div className="hd-stats">
        <div className="hd-stat">
          <span>Copies</span>
          <b>
            {
              activities.filter((a) => a.type.startsWith("copy")).length
            }
          </b>
        </div>
        <div className="hd-stat">
          <span>Status moves</span>
          <b>
            {activities.filter((a) => a.type === "status_change").length}
          </b>
        </div>
        <div className="hd-stat">
          <span>Views</span>
          <b>{activities.filter((a) => a.type === "view").length}</b>
        </div>
        <div className="hd-stat">
          <span>Opens</span>
          <b>{activities.filter((a) => a.type === "open_link").length}</b>
        </div>
      </div>

      {byDay.length === 0 ? (
        <div className="empty">No activity yet — apply / copy / open cards</div>
      ) : (
        byDay.map(([day, rows]) => (
          <section key={day} className="hd-hist-day">
            <h3>{day}</h3>
            <ul>
              {rows.map((a) => (
                <li key={a.id}>
                  <span className="job-chip">{a.type}</span>
                  <span>{a.entityLabel || a.entityId || "—"}</span>
                  {a.detail && <em>{a.detail}</em>}
                  <time>{a.createdAt.slice(11, 16)}Z</time>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
