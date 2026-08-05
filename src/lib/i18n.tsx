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

export type Locale = "ru" | "uk";

const STORAGE_KEY = "hire-desk-locale";

type Dict = Record<string, string>;

const ru: Dict = {
  "nav.queue": "Очередь",
  "nav.individuals": "Люди",
  "nav.applied": "Отклики",
  "nav.history": "История",
  "nav.harvest": "Harvest",
  "nav.templates": "Шаблоны",
  "nav.admin": "Admin",
  "nav.add": "+ Добавить",
  "rail.europe": "Europe rail",
  "rail.america": "America rail",
  "rail.asia": "Asia rail",
  "rail.jobs_quota": "{jobs} вакансий · квота {left}",
  "rail.tap": "нажми — фильтр на главной",
  "rail.active": "активный фильтр",
  "empty.queue": "Пусто на этом рейле — harvest или добавь вакансию",
  "empty.individuals":
    "Пока никого — MAX LIVE вытащит контакты, или + Добавить",
  "empty.applied": "Нет откликов в этом виде",
  "toast.job_added": "Вакансия добавлена",
  "toast.ind_added": "Контакт добавлен",
  "toast.copied": "Скопировано",
  "quota.eu": "EU",
  "quota.us": "US",
  "quota.as": "AS",
  "quota.ind": "IND",
  "popup.open": "Открыть ссылку",
  "popup.copy_apply": "Copy apply",
  "popup.copy_brief": "Copy brief",
  "popup.queue": "В очередь",
  "popup.applied": "Откликнулся",
  "popup.reject": "Отказ",
  "popup.delete": "Удалить",
  "lang.ru": "РУ",
  "lang.uk": "УКР",
};

const uk: Dict = {
  "nav.queue": "Черга",
  "nav.individuals": "Люди",
  "nav.applied": "Відгуки",
  "nav.history": "Історія",
  "nav.harvest": "Harvest",
  "nav.templates": "Шаблони",
  "nav.admin": "Admin",
  "nav.add": "+ Додати",
  "rail.europe": "Europe rail",
  "rail.america": "America rail",
  "rail.asia": "Asia rail",
  "rail.jobs_quota": "{jobs} вакансій · квота {left}",
  "rail.tap": "натисни — фільтр на головній",
  "rail.active": "активний фільтр",
  "empty.queue": "Порожньо на цьому рейлі — harvest або додай вакансію",
  "empty.individuals":
    "Поки нікого — MAX LIVE витягне контакти, або + Додати",
  "empty.applied": "Немає відгуків у цьому вигляді",
  "toast.job_added": "Вакансію додано",
  "toast.ind_added": "Контакт додано",
  "toast.copied": "Скопійовано",
  "quota.eu": "EU",
  "quota.us": "US",
  "quota.as": "AS",
  "quota.ind": "IND",
  "popup.open": "Відкрити лінк",
  "popup.copy_apply": "Copy apply",
  "popup.copy_brief": "Copy brief",
  "popup.queue": "У чергу",
  "popup.applied": "Відгукнувся",
  "popup.reject": "Відмова",
  "popup.delete": "Видалити",
  "lang.ru": "РУ",
  "lang.uk": "УКР",
};

const DICTS: Record<Locale, Dict> = { ru, uk };

type I18nCtx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const Ctx = createContext<I18nCtx | null>(null);

function format(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    vars[k] != null ? String(vars[k]) : `{${k}}`,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("ru");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "ru" || raw === "uk") setLocaleState(raw);
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
      const dict = DICTS[locale];
      return format(dict[key] || DICTS.ru[key] || key, vars);
    },
    [locale],
  );

  const value = useMemo(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
