"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";

type Telemetry = {
  ok: boolean;
  at: string;
  build: string;
  platform: {
    status: "ok" | "degraded" | "down";
    mode: string;
    storage: string;
    runTarget: number;
    configuredTarget: number;
    dayCeiling: number;
    jobsTotal: number;
    individualsTotal: number;
    harvestToday: number;
    harvestRemainingToday: number;
  };
  firebase: {
    ok: boolean;
    projectId?: string;
    error?: string;
    latencyMs: number;
    softQuota: { readsPerDay: number; writesPerDay: number };
    usage: {
      day: string | null;
      readsApprox: number;
      writesApprox: number;
      readsLeftApprox: number;
      writesLeftApprox: number;
      readsPct?: number;
      writesPct?: number;
      exhausted?: boolean;
      source?: string;
      note: string;
    };
  };
  render: {
    serviceHint: string;
    uptimeSec: number;
    node: string;
    mem: { rssMb: number; heapMb: number };
  };
  harvest: {
    running: boolean;
    message: string | null;
    segment: string | null;
    added: number;
    skipped: number;
    trashed: number;
    heartbeatAgeMs: number | null;
    heartbeatOk: boolean;
  };
  sources: {
    count: number;
    proxy: boolean;
    proxyMode: string;
    proxyPool: number;
    remotive: boolean;
    ats: boolean;
    html: boolean;
    telegram: boolean;
  };
};

function tone(status: string) {
  if (status === "ok") return "var(--green)";
  if (status === "degraded") return "var(--gold)";
  return "var(--red)";
}

function fmtUptime(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function msUntilUtcMidnight(now = Date.now()) {
  const d = new Date(now);
  const next = Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() + 1,
  );
  return Math.max(0, next - now);
}

function fmtCountdown(ms: number) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

function useUtcQuotaCountdown() {
  const [leftMs, setLeftMs] = useState(() => msUntilUtcMidnight());
  useEffect(() => {
    const id = window.setInterval(() => {
      setLeftMs(msUntilUtcMidnight());
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
  return leftMs;
}

export function OpsTelemetry() {
  const { t } = useI18n();
  const [data, setData] = useState<Telemetry | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/ops/telemetry", { cache: "no-store" });
        const raw = await res.text();
        if (!raw.trim()) return;
        const json = JSON.parse(raw) as Telemetry;
        if (!cancelled) {
          setData(json);
          setErr(null);
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "telemetry fail");
        }
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const status = data?.platform.status ?? "down";

  return (
    <section className="hd-ops" data-tour="ops-telemetry">
      <div className="hd-ops__head">
        <h2>{t("ops.title")}</h2>
        <div className="hd-ops__pulse">
          <span
            className="hd-ops__dot"
            style={{
              background: tone(status),
              boxShadow: `0 0 12px ${tone(status)}`,
            }}
          />
          <span style={{ color: tone(status) }}>{status.toUpperCase()}</span>
          <em>
            {data?.at
              ? new Date(data.at).toLocaleTimeString("en-GB", {
                  hour12: false,
                })
              : "…"}
          </em>
        </div>
      </div>

      {err && <p className="hd-ops__err">{err}</p>}
      {!data && !err && <p className="hd-ops__muted">{t("ops.linking")}</p>}

      {data && (
        <div className="hd-ops__grid">
          <OpsCard
            title={t("ops.platform")}
            accent="eu"
            lines={[
              `build ${data.build}`,
              `mode ${data.platform.mode} · ${data.platform.storage}`,
              `jobs ${data.platform.jobsTotal} · people ${data.platform.individualsTotal}`,
              `today ${data.platform.harvestToday} · left ~${data.platform.harvestRemainingToday}/${data.platform.dayCeiling}`,
              `target ≥${data.platform.runTarget}${
                data.platform.runTarget !== data.platform.configuredTarget
                  ? ` (cfg ${data.platform.configuredTarget})`
                  : ""
              }`,
            ]}
          />
          <FirebaseQuotaCard firebase={data.firebase} />
          <OpsCard
            title={t("ops.render")}
            accent="us"
            lines={[
              data.render.serviceHint,
              `uptime ${fmtUptime(data.render.uptimeSec)}`,
              `node ${data.render.node}`,
              `RSS ${data.render.mem.rssMb}MB · heap ${data.render.mem.heapMb}MB`,
            ]}
          />
          <OpsCard
            title={t("ops.harvest")}
            accent={
              data.harvest.running
                ? data.harvest.heartbeatOk
                  ? "eu"
                  : "us"
                : undefined
            }
            tone={
              data.harvest.running
                ? data.harvest.heartbeatOk
                  ? "var(--cyan)"
                  : "var(--gold)"
                : "var(--muted)"
            }
            lines={[
              data.harvest.running ? "RUNNING" : "idle",
              data.harvest.segment || "—",
              `+${data.harvest.added} · skip ${data.harvest.skipped} · trash ${data.harvest.trashed}`,
              data.harvest.heartbeatAgeMs != null
                ? `heartbeat ${Math.round(data.harvest.heartbeatAgeMs / 1000)}s ago · ${data.harvest.heartbeatOk ? "ok" : "STALE"}`
                : "heartbeat —",
              data.harvest.message || "",
              `src ${data.sources.count} · Proxy ${data.sources.proxy ? "ON" : "OFF"} · Remotive ${data.sources.remotive ? "ON" : "OFF"} · ATS ${data.sources.ats ? "ON" : "OFF"}`,
            ]}
          />
        </div>
      )}
    </section>
  );
}

function quotaTone(pct: number) {
  if (pct >= 90) return "var(--red)";
  if (pct >= 70) return "var(--gold)";
  return "var(--cyan)";
}

function QuotaBar({
  label,
  used,
  limit,
  left,
  unit,
}: {
  label: string;
  used: number;
  limit: number;
  left: number;
  unit: "reads" | "writes";
}) {
  const pct =
    limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0;
  const color = quotaTone(pct);
  const remainingLabel =
    left <= 0
      ? unit === "reads"
        ? "reads exhausted · harvest waits for reset"
        : "writes exhausted"
      : `~${left.toLocaleString("en-US")} ${unit} left`;
  return (
    <div className="hd-ops__quota">
      <div className="hd-ops__quota-row">
        <span>{label}</span>
        <b style={{ color }}>
          {pct}% · {used.toLocaleString("en-US")} /{" "}
          {limit.toLocaleString("en-US")}
        </b>
      </div>
      <div className="hd-ops__bar">
        <div
          style={{
            width: `${pct}%`,
            background: color,
            boxShadow: `0 0 14px ${color}`,
          }}
        />
      </div>
      <div
        className="hd-ops__quota-hint"
        style={{
          color:
            left <= 0 && unit === "reads" ? "var(--gold)" : "var(--muted)",
        }}
      >
        {remainingLabel}
      </div>
    </div>
  );
}

function FirebaseQuotaCard({ firebase }: { firebase: Telemetry["firebase"] }) {
  const leftMs = useUtcQuotaCountdown();
  const exhausted = Boolean(firebase.usage.exhausted) || !firebase.ok;
  const readsUsed = firebase.usage.readsApprox;
  const writesUsed = firebase.usage.writesApprox;
  const readsPct = exhausted
    ? Math.max(
        99,
        firebase.softQuota.readsPerDay > 0
          ? Math.min(
              100,
              Math.round(
                (readsUsed / firebase.softQuota.readsPerDay) * 1000,
              ) / 10,
            )
          : 99,
      )
    : firebase.softQuota.readsPerDay > 0
      ? Math.min(
          100,
          Math.round((readsUsed / firebase.softQuota.readsPerDay) * 1000) / 10,
        )
      : 0;
  const nearEmpty =
    exhausted ||
    readsPct >= 90 ||
    firebase.usage.readsLeftApprox <= 0;
  const resetColor = nearEmpty ? "var(--gold)" : "var(--cyan)";

  return (
    <div className={`hd-ops__card ${firebase.ok && !exhausted ? "eu" : "warn"}`}>
      <div
        className="hd-ops__card-title"
        style={{
          color: firebase.ok && !exhausted ? "var(--green)" : "var(--red)",
        }}
      >
        Firebase
      </div>
      <ul className="hd-ops__lines">
        <li>
          {exhausted
            ? `EXHAUSTED · ${firebase.error || "quota"}`
            : firebase.ok
              ? "link OK"
              : `FAIL · ${firebase.error || "?"}`}
        </li>
        <li>project {firebase.projectId || "—"}</li>
        <li>
          today ~{readsUsed.toLocaleString("en-US")} reads · ~
          {writesUsed.toLocaleString("en-US")} writes
          {firebase.usage.source ? (
            <span className="hd-ops__dim"> · {firebase.usage.source}</span>
          ) : null}
        </li>
        <li>latency {firebase.latencyMs}ms</li>
        <li style={{ color: resetColor }}>
          quota reset in {fmtCountdown(leftMs)}
          <span className="hd-ops__dim"> · 00:00 UTC</span>
        </li>
      </ul>
      <div className="hd-ops__quota-stack">
        <QuotaBar
          label="Reads / day"
          used={
            exhausted && readsUsed <= 0
              ? firebase.softQuota.readsPerDay
              : readsUsed
          }
          limit={firebase.softQuota.readsPerDay}
          left={exhausted ? 0 : firebase.usage.readsLeftApprox}
          unit="reads"
        />
        <QuotaBar
          label="Writes / day"
          used={writesUsed}
          limit={firebase.softQuota.writesPerDay}
          left={exhausted ? 0 : firebase.usage.writesLeftApprox}
          unit="writes"
        />
      </div>
      <p className="hd-ops__note">{firebase.usage.note}</p>
    </div>
  );
}

function OpsCard({
  title,
  lines,
  accent,
  tone: titleTone,
}: {
  title: string;
  lines: string[];
  accent?: "eu" | "us";
  tone?: string;
}) {
  return (
    <div className={`hd-ops__card ${accent || ""}`}>
      <div
        className="hd-ops__card-title"
        style={{ color: titleTone || undefined }}
      >
        {title}
      </div>
      <ul className="hd-ops__lines">
        {lines.filter(Boolean).map((line, i) => (
          <li key={`${i}-${line.slice(0, 28)}`}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
