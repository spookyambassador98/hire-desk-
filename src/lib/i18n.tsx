"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DICTS,
  isLocale,
  type Dict,
  type Locale,
} from "@/lib/i18n/dicts";
import type { IndividualKind, JobStatus, Region } from "@/lib/types";
import { jobPostedAt } from "@/lib/regions";
import { scheduleChips as rawScheduleChips, salaryLabel as rawSalary } from "@/lib/text";

export type { Locale };

const STORAGE_KEY = "hire-desk-locale";

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  trRegion: (r: Region) => string;
  trStatus: (s: string) => string;
  trKind: (k: IndividualKind) => string;
  trAge: (iso: string) => { label: string; stale: boolean };
  trSalary: (
    salary: Parameters<typeof rawSalary>[0],
  ) => string;
  trSchedule: (job: Parameters<typeof rawScheduleChips>[0]) => string[];
};

const Ctx = createContext<I18nCtx | null>(null);

function format(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] != null ? String(vars[k]) : `{${k}}`,
  );
}

function lookup(dict: Dict, key: string) {
  return dict[key] || DICTS.en[key] || key;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ru");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (isLocale(raw)) setLocaleState(raw);
      // Drop pre-v3 translate poison (failed MyMemory EN caches)
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith("tr:") || k.startsWith("hire-tr:v1") || k.startsWith("hire-tr:v2"))) {
          sessionStorage.removeItem(k);
        }
      }
    } catch {
      /* ignore */
    }
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      return format(lookup(DICTS[locale], key), vars);
    },
    [locale],
  );

  const trRegion = useCallback(
    (r: Region) => t(`region.${r}`),
    [t],
  );

  const trStatus = useCallback(
    (s: string) => {
      const key = `status.${s}`;
      const v = lookup(DICTS[locale], key);
      return v === key ? s : v;
    },
    [locale],
  );

  const trKind = useCallback(
    (k: IndividualKind) => t(`ind.${k}`),
    [t],
  );

  const trAge = useCallback(
    (iso: string) => {
      const ms = Date.parse(iso);
      if (Number.isNaN(ms)) {
        return { label: t("age.unknown"), stale: false };
      }
      const hours = Math.max(0, (Date.now() - ms) / 3_600_000);
      const days = hours / 24;
      const stale = days > 7;
      if (hours < 1) return { label: t("age.lt1h"), stale };
      if (hours < 48) {
        return {
          label: t("age.hours", { n: Math.max(1, Math.round(hours)) }),
          stale,
        };
      }
      if (days < 14) {
        return {
          label: t("age.days", { n: Math.max(1, Math.round(days)) }),
          stale,
        };
      }
      return {
        label: t("age.weeks", { n: Math.max(1, Math.round(days / 7)) }),
        stale,
      };
    },
    [t],
  );

  const trSalary = useCallback(
    (salary: Parameters<typeof rawSalary>[0]) => {
      if (!salary || (salary.min == null && salary.max == null)) {
        return t("comp.tbd");
      }
      const unit =
        salary.period === "hour"
          ? "/h"
          : salary.period === "month"
            ? "/mo"
            : "/yr";
      const fmt = (n: number) => {
        if (salary.period === "hour") return `${salary.currency} ${n}${unit}`;
        if (n >= 1000)
          return `${salary.currency} ${Math.round(n / 1000)}k${unit}`;
        return `${salary.currency} ${n}${unit}`;
      };
      if (salary.min != null && salary.max != null) {
        return `${fmt(salary.min)}–${fmt(salary.max)}`;
      }
      if (salary.min != null) return t("comp.from", { v: fmt(salary.min) });
      return t("comp.up_to", { v: fmt(salary.max!) });
    },
    [t],
  );

  const trSchedule = useCallback(
    (job: Parameters<typeof rawScheduleChips>[0]) => {
      const map: Record<string, string> = {
        Remote: t("sched.remote"),
        Hybrid: t("sched.hybrid"),
        "On-site": t("sched.onsite"),
        "Full-time": t("sched.fulltime"),
        "Part-time": t("sched.parttime"),
        Contract: t("sched.contract"),
        Intern: t("sched.intern"),
      };
      return rawScheduleChips(job).map((s) => map[s] || s);
    },
    [t],
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      trRegion,
      trStatus,
      trKind,
      trAge,
      trSalary,
      trSchedule,
    }),
    [
      locale,
      setLocale,
      t,
      trRegion,
      trStatus,
      trKind,
      trAge,
      trSalary,
      trSchedule,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}

export function useJobAge(job: { postedAt?: string | null; createdAt: string }) {
  const { trAge } = useI18n();
  return trAge(jobPostedAt(job));
}

export type { JobStatus };
