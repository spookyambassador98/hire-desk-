"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useSpring, useTransform } from "framer-motion";
import { useI18n } from "@/lib/i18n";
import { useTranslatedText } from "@/hooks/useTranslatedText";
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
  fit?: number | null;
  pri?: number | null;
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

const EASE = [0.16, 1, 0.3, 1] as const;

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

function IntakeRole({ text }: { text: string }) {
  const { text: role } = useTranslatedText(text);
  return <>{role}</>;
}

function Kinetic({ value, prefix = "" }: { value: number; prefix?: string }) {
  const spring = useSpring(value, { stiffness: 120, damping: 18, mass: 0.6 });
  const display = useTransform(spring, (v) => `${prefix}${Math.round(v)}`);
  const [text, setText] = useState(`${prefix}${value}`);

  useEffect(() => {
    spring.set(value);
  }, [spring, value]);

  useEffect(() => {
    const unsub = display.on("change", (v) => setText(v));
    return () => unsub();
  }, [display]);

  return <b>{text}</b>;
}

function RegionRadar({
  intake,
  running,
}: {
  intake: IntakeHit[];
  running: boolean;
}) {
  const counts = useMemo(() => {
    const c = { europe: 0, america: 0, asia: 0 };
    for (const h of intake) {
      if (h.region === "america") c.america += 1;
      else if (h.region === "asia") c.asia += 1;
      else c.europe += 1;
    }
    const total = Math.max(1, c.europe + c.america + c.asia);
    return {
      europe: c.europe / total,
      america: c.america / total,
      asia: c.asia / total,
      raw: c,
    };
  }, [intake]);

  const arcs: Array<{
    key: Region;
    color: string;
    pct: number;
    r: number;
  }> = [
    { key: "europe", color: "var(--eu)", pct: counts.europe, r: 42 },
    { key: "america", color: "var(--us)", pct: counts.america, r: 34 },
    { key: "asia", color: "var(--asia)", pct: counts.asia, r: 26 },
  ];

  return (
    <div className={`hire-max__radar${running ? " is-live" : ""}`}>
      <svg viewBox="0 0 100 100" className="hire-max__radar-svg" aria-hidden>
        <circle cx="50" cy="50" r="46" className="hire-max__radar-ring" />
        <circle cx="50" cy="50" r="38" className="hire-max__radar-ring" />
        <circle cx="50" cy="50" r="30" className="hire-max__radar-ring" />
        {arcs.map((a) => {
          const circ = 2 * Math.PI * a.r;
          const dash = Math.max(0.01, a.pct) * circ;
          return (
            <circle
              key={a.key}
              cx="50"
              cy="50"
              r={a.r}
              fill="none"
              stroke={a.color}
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circ}`}
              transform="rotate(-90 50 50)"
              className="hire-max__radar-arc"
              style={{ filter: `drop-shadow(0 0 4px ${a.color})` }}
            />
          );
        })}
        <circle cx="50" cy="50" r="2.2" className="hire-max__radar-core" />
        {running && (
          <g className="hire-max__radar-sweep">
            <path
              d="M50 50 L50 8"
              stroke="rgba(94,231,255,0.55)"
              strokeWidth="1"
            />
          </g>
        )}
      </svg>
      <div className="hire-max__radar-legend">
        <span className="eu">
          EU <b>{counts.raw.europe}</b>
        </span>
        <span className="us">
          US <b>{counts.raw.america}</b>
        </span>
        <span className="asia">
          AS <b>{counts.raw.asia}</b>
        </span>
      </div>
    </div>
  );
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
  const [flashId, setFlashId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const logBoxRef = useRef<HTMLDivElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const userStoppedRef = useRef(false);
  const seenIds = useRef(new Set<string>());

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
      if (data.live?.recentAdds) {
        const next = data.live.recentAdds;
        const newest = next[0];
        if (newest && !seenIds.current.has(newest.id)) {
          seenIds.current.add(newest.id);
          setFlashId(newest.id);
          window.setTimeout(() => setFlashId(null), 900);
        }
        for (const h of next) seenIds.current.add(h.id);
        setIntake(next);
      }
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
    seenIds.current.clear();
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
      pollRef.current = setInterval(() => void loadStatus(), 1800);
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

  const beatIso = live?.heartbeatAt || live?.startedAt || null;
  const beatAgeSec = beatIso
    ? Math.max(0, (Date.now() - Date.parse(beatIso)) / 1000)
    : null;
  void tick;
  const beatStale =
    running && beatAgeSec != null ? beatAgeSec > 90 : beatAgeSec != null && beatAgeSec > 180;
  const beatWarn =
    running && beatAgeSec != null ? beatAgeSec > 45 : false;
  const beatTone = beatStale ? "bad" : beatWarn ? "warn" : "ok";
  const proxyOn = (status?.proxyPool ?? 0) > 0;

  return (
    <div className="harvest-stage">
      <div className="hire-max">
        <div className="hire-max__head">
          <div>
            <div className="hire-max__kicker">APEX // HARVEST ENGINE</div>
            <h2 className="hire-max__title">MAX LIVE</h2>
            <p className="hire-max__sub">
              Target ≥{target} · day cap {dayCap} · proxy{" "}
              {proxyOn ? `ON (${status?.proxyPool})` : "OFF"} ·{" "}
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

        <div className="hire-max__engine">
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
      </div>

      <div className="hire-live-rail">
        <aside className="hire-max__ops" aria-label={t("intake.ops_title")}>
          <div className="hire-max__feed-head">
            <div>
              <div className="hire-max__feed-kicker">
                {t("intake.ops_kicker")}
              </div>
              <h3 className="hire-max__feed-title">{t("intake.ops_title")}</h3>
            </div>
            <div
              className={`hire-max__feed-pulse${running ? " is-live" : ""}`}
            >
              <span />
              {running ? t("intake.live") : t("intake.idle")}
            </div>
          </div>

          <RegionRadar intake={intake} running={running} />

          <div className="hire-max__vitals">
            <div>
              <em>{t("intake.added")}</em>
              <Kinetic value={added} prefix="+" />
            </div>
            <div>
              <em>{t("intake.skip")}</em>
              <Kinetic value={skipped} />
            </div>
            <div>
              <em>{t("intake.trash")}</em>
              <Kinetic value={trashed} />
            </div>
            <div>
              <em>{t("intake.segment")}</em>
              <b title={live?.segment || ""}>{live?.segment || "—"}</b>
            </div>
          </div>

          <div className={`hire-max__ribbon hire-max__ribbon--${beatTone}`}>
            <span className="hire-max__ribbon-heart">♥</span>
            <span>
              {beatAgeSec == null
                ? "—"
                : `${beatAgeSec < 10 ? beatAgeSec.toFixed(1) : Math.round(beatAgeSec)}s`}
            </span>
            <span className="hire-max__ribbon-sep">·</span>
            <span className="hire-max__ribbon-seg">
              {live?.segment || "—"}
            </span>
            <span className="hire-max__ribbon-sep">·</span>
            <span>proxy {proxyOn ? "ON" : "OFF"}</span>
          </div>
        </aside>

        <aside className="hire-max__feed" aria-live="polite">
          <div className="hire-max__feed-head">
            <div>
              <div className="hire-max__feed-kicker">
                {t("intake.kicker")}
              </div>
              <h3 className="hire-max__feed-title">{t("intake.title")}</h3>
            </div>
            <div className="hire-max__feed-count">{intake.length}</div>
          </div>

          <div className="hire-max__feed-list" ref={feedRef}>
            {intake.length === 0 ? (
              <div className="hire-max__feed-empty">{t("intake.empty")}</div>
            ) : (
              <AnimatePresence initial={false}>
                {intake.map((hit, idx) => {
                  const r = (hit.region || "europe") as Region;
                  const isFlash = flashId === hit.id;
                  const company = (hit.company || "").trim() || "—";
                  const role = (hit.role || "").trim() || "—";
                  return (
                    <motion.article
                      key={`${hit.id}-${hit.at}`}
                      className={`hire-max__hit${isFlash ? " is-flash" : ""}`}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.28, ease: EASE }}
                    >
                      <div className="hire-max__hit-top">
                        <span className={`job-chip ${regionClass(r)}`}>
                          {trRegion(r)}
                        </span>
                        <div className="hire-max__hit-meta">
                          <span className="hire-max__hit-score">
                            {t("score.fit")} {hit.fit ?? "—"}
                          </span>
                          <span className="hire-max__hit-score hire-max__hit-score--pri">
                            {t("score.pri")} {hit.pri ?? "—"}
                          </span>
                          <time>{fmtAgo(hit.at)}</time>
                        </div>
                      </div>
                      <div className="hire-max__hit-co">{company}</div>
                      <div className="hire-max__hit-role">
                        <IntakeRole text={role} />
                      </div>
                      <div className="hire-max__hit-src">
                        {shortSource(hit.source)}
                        {idx === 0 ? " · NEW" : ""}
                      </div>
                    </motion.article>
                  );
                })}
              </AnimatePresence>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
