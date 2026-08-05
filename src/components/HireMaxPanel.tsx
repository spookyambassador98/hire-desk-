"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type QuotaRow = {
  segmentId: string;
  label: string;
  today: number;
  quota: number;
  remaining: number;
  pct: number;
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
  paused?: boolean;
  live?: LiveState;
};

type Props = {
  onFilled?: () => void;
};

export function HireMaxPanel({ onFilled }: Props) {
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [stopping, setStopping] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
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
    if (logBoxRef.current) {
      logBoxRef.current.scrollTop = logBoxRef.current.scrollHeight;
    }
  }, [logs]);

  async function startMax() {
    userStoppedRef.current = false;
    setRunning(true);
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
      pollRef.current = setInterval(() => void loadStatus(), 2500);
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

  return (
    <div className="hire-max">
      <div className="hire-max__head">
        <div>
          <div className="hire-max__kicker">APEX // HARVEST ENGINE</div>
          <h2 className="hire-max__title">MAX LIVE</h2>
          <p className="hire-max__sub">
            Target ≥{target} · day cap {dayCap} · proxy{" "}
            {status?.proxyPool ? `ON (${status.proxyPool})` : "OFF"} ·{" "}
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
            {stopping ? "…" : "STOP"}
          </button>
        </div>
      </div>

      {message && <div className="hire-max__msg">{message}</div>}

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
  );
}
