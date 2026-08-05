"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { regionClass } from "@/lib/regions";
import type { Region } from "@/lib/types";

type QuotaRow = {
  segmentId: string;
  label: string;
  today: number;
  quota: number;
  remaining: number;
  pct: number;
};

type IntakeHit = {
  id: string;
  company: string;
  role: string;
  region: string;
  source: string | null;
  at: string;
};

type LiveState = {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  heartbeatAt?: string | null;
  added: number;
  skipped: number;
  trashed: number;
  segment: string | null;
  message: string;
  logs: string[];
  recentAdds?: IntakeHit[];
};

type StatusPayload = {
  runTarget: number;
  dailyQuotaPerSegment: number;
  totalCapacity: number;
  totalToday: number;
  totalRemaining: number;
  quotas: QuotaRow[];
  sources: Array<{ id: string; label: string; tier: string }>;
  proxyPool: number;
  storage?: "local" | "firebase";
  firebase?: { ok: boolean; error?: string; projectId?: string } | null;
  paused?: boolean;
  live?: LiveState;
};

type Props = {
  onFilled?: () => void;
};

function fmtAgo(iso: string, now = Date.now()) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}

function shortSource(src: string | null) {
  if (!src) return "—";
  const part = src.split(":").pop() || src;
  return part.replace(/^max:/, "").slice(0, 18);
}

export function HireMaxPanel({ onFilled }: Props) {
  const { t, trRegion } = useI18n();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [intake, setIntake] = useState<IntakeHit[]>([]);
  const [stopping, setStopping] = useState(false);
  const [tick, setTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const userStoppedRef = useRef(false);

  const stopPoll = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/harvest/status", { cache: "no-store" });
      const data = (await res.json()) as StatusPayload;
      setStatus(data);
      if (data.live?.logs?.length) setLogs(data.live.logs);
      if (data.live?.message) setMessage(data.live.message);
      if (data.live?.recentAdds) setIntake(data.live.recentAdds);
      if (userStoppedRef.current) {
        setRunning(false);
        return data;
      }
      if (data.live?.running) setRunning(true);
      else if (running && data.live && !data.live.running) {
        setRunning(false);
        stopPoll();
        onFilled?.();
      }
      return data;
    } catch {
      return null;
    }
  }, [onFilled, running, stopPoll]);

  useEffect(() => {
    void loadStatus();
    const soft = setInterval(() => void loadStatus(), 12_000);
    return () => clearInterval(soft);
  }, [loadStatus]);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    if (feedRef.current) feedRef.current.scrollTop = 0;
  }, [intake.length]);

  async function startMax() {
    userStoppedRef.current = false;
    setRunning(true);
    setIntake([]);
    setMessage("Starting MAX LIVE…");
    stopPoll();
    try {
      const res = await fetch("/api/harvest/run", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-harvest-manual": "1",
        },
        body: JSON.stringify({ manual: true, source: "ui" }),
      });
      const data = (await res.json()) as {
        message?: string;
        alreadyRunning?: boolean;
      };
      setMessage(data.message || "Running");
      pollRef.current = setInterval(() => void loadStatus(), 2000);
    } catch {
      setRunning(false);
      setMessage("Start failed");
    }
  }

  async function stopMax() {
    setStopping(true);
    userStoppedRef.current = true;
    try {
      await fetch("/api/harvest/stop", { method: "POST" });
      setRunning(false);
      setMessage("⏹ Stopped");
      stopPoll();
      await loadStatus();
    } finally {
      setStopping(false);
    }
  }

  const target = status?.runTarget ?? 80;
  const dayCap = status?.totalCapacity ?? 320;
  const live = status?.live;
  const added = live?.added ?? 0;
  const skipped = live?.skipped ?? 0;
  const trashed = live?.trashed ?? 0;
  void tick;

  return (
    <div className="hire-max">
      <div className="hire-max__head">
        <div>
          <div className="hire-max__kicker">APEX // HARVEST ENGINE</div>
          <h2 className="hire-max__title">MAX LIVE</h2>
          <p className="hire-max__sub">
            Target ≥{target} · day cap {dayCap} · proxy{" "}
            {status?.proxyPool ? `ON (${status.proxyPool})` : "OFF"} ·{" "}
            {status?.storage === "firebase" ? "Firebase" : "local"} ·{" "}
            {status?.sources?.length ?? 0} sources
          </p>
        </div>
        <div className="hire-max__actions">
          <button
            type="button"
            className="hire-max__go"
            disabled={running}
            onClick={() => void startMax()}
          >
            {running ? "RUNNING…" : "MAX LIVE"}
          </button>
          <button
            type="button"
            className="hire-max__stop"
            disabled={!running && !stopping}
            onClick={() => void stopMax()}
          >
            {stopping ? t("max.stopping") : t("max.stop")}
          </button>
        </div>
      </div>

      {message && <div className="hire-max__msg">{message}</div>}

      <div className="hire-max__grid">
        <div className="hire-max__col">
          <div className="hire-max__quotas">
            {(status?.quotas || []).map((q) => (
              <div key={q.segmentId} className="hire-max__q">
                <div className="hire-max__q-label">{q.label}</div>
                <div className="hire-max__q-bar">
                  <span style={{ width: `${q.pct}%` }} />
                </div>
                <div className="hire-max__q-meta">
                  {q.today}/{q.quota}
                </div>
              </div>
            ))}
          </div>

          <div className="hire-max__log" ref={logBoxRef}>
            {logs.length === 0 ? (
              <div className="hire-max__log-empty">
                (log empty — press MAX LIVE)
              </div>
            ) : (
              logs.map((line, i) => (
                <div key={`${i}-${line.slice(0, 24)}`}>{line}</div>
              ))
            )}
          </div>

          {status?.sources && status.sources.length > 0 && (
            <div className="hire-max__sources">
              {status.sources.map((s) => (
                <span key={s.id} className="job-chip">
                  {s.tier}:{s.id}
                </span>
              ))}
            </div>
          )}
        </div>

        <aside className="hire-max__feed" aria-live="polite">
          <div className="hire-max__feed-head">
            <div>
              <div className="hire-max__feed-kicker">
                {t("intake.kicker")}
              </div>
              <h3 className="hire-max__feed-title">{t("intake.title")}</h3>
            </div>
            <div
              className={`hire-max__feed-pulse${running ? " is-live" : ""}`}
            >
              <span />
              {running ? t("intake.live") : t("intake.idle")}
            </div>
          </div>

          <div className="hire-max__vitals">
            <div>
              <em>{t("intake.added")}</em>
              <b>+{added}</b>
            </div>
            <div>
              <em>{t("intake.skip")}</em>
              <b>{skipped}</b>
            </div>
            <div>
              <em>{t("intake.trash")}</em>
              <b>{trashed}</b>
            </div>
            <div>
              <em>{t("intake.segment")}</em>
              <b>{live?.segment || "—"}</b>
            </div>
          </div>

          <div className="hire-max__feed-list" ref={feedRef}>
            {intake.length === 0 ? (
              <div className="hire-max__feed-empty">{t("intake.empty")}</div>
            ) : (
              intake.map((hit) => {
                const r = (hit.region || "europe") as Region;
                return (
                  <div key={`${hit.id}-${hit.at}`} className="hire-max__hit">
                    <div className="hire-max__hit-top">
                      <span className={`job-chip ${regionClass(r)}`}>
                        {trRegion(r)}
                      </span>
                      <time>{fmtAgo(hit.at)}</time>
                    </div>
                    <div className="hire-max__hit-co">{hit.company}</div>
                    <div className="hire-max__hit-role">{hit.role}</div>
                    <div className="hire-max__hit-src">
                      {shortSource(hit.source)}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
