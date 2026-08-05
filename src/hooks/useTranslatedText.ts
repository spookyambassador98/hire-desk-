"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";

/** Bump when translate backend changes — drops poisoned EN caches. */
const CACHE_VER = "v3";

const mem = new Map<string, string>();

function cacheKey(locale: Locale, text: string) {
  return `${CACHE_VER}:${locale}::${text.slice(0, 32)}::${text.length}::${hash(text)}`;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function sessionKey(key: string) {
  return `hire-tr:${key}`;
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(sessionKey(key));
  } catch {
    return null;
  }
}

function writeSession(key: string, val: string) {
  try {
    sessionStorage.setItem(sessionKey(key), val);
  } catch {
    /* ignore quota */
  }
}

function looksTranslated(source: string, out: string, locale: Locale) {
  if (locale === "en") return true;
  const a = source.trim();
  const b = out.trim();
  if (!b) return false;
  if (b !== a) return true;
  // Identical output for non-EN is only OK for non-translatable tokens
  // (URLs, brand codes). Long Latin prose = failed translate — do not cache.
  if (a.length < 12) return true;
  if (/[А-Яа-яЁёІіЇїЄєҐґ]/.test(a)) return true;
  return !/[A-Za-z]{4}/.test(a);
}

function remember(key: string, source: string, out: string, locale: Locale) {
  if (!looksTranslated(source, out, locale)) return false;
  mem.set(key, out);
  writeSession(key, out);
  return true;
}

function cached(key: string): string | null {
  return mem.get(key) || readSession(key);
}

type Waiter = {
  resolve: (text: string) => void;
  reject: (err: unknown) => void;
};

/** Deduped pending strings per locale */
const pending = new Map<string, { locale: Locale; text: string; waiters: Waiter[] }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let activeFlushes = 0;
const MAX_FLUSH = 3;
const BATCH = 10;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPending();
  }, 40);
}

async function flushPending() {
  if (activeFlushes >= MAX_FLUSH || pending.size === 0) return;
  activeFlushes += 1;
  try {
    while (pending.size > 0) {
      const batch: Array<{ key: string; locale: Locale; text: string; waiters: Waiter[] }> =
        [];
      for (const [key, job] of pending) {
        if (batch.length && batch[0]!.locale !== job.locale) continue;
        batch.push({ key, ...job });
        pending.delete(key);
        if (batch.length >= BATCH) break;
      }
      if (!batch.length) break;

      const locale = batch[0]!.locale;
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locale,
            texts: batch.map((b) => b.text),
          }),
        });
        const data = (await res.json()) as {
          texts?: string[];
          error?: string;
        };
        const ok =
          Array.isArray(data.texts) && data.texts.length === batch.length;
        batch.forEach((b, i) => {
          const raw = ok ? data.texts![i]?.trim() || "" : "";
          const next = raw && looksTranslated(b.text, raw, locale) ? raw : "";
          if (next) {
            remember(b.key, b.text, next, locale);
            b.waiters.forEach((w) => w.resolve(next));
          } else {
            // Do not poison cache — leave source for UI, allow retry later
            b.waiters.forEach((w) => w.resolve(b.text));
          }
        });
      } catch (err) {
        batch.forEach((b) => b.waiters.forEach((w) => w.reject(err)));
      }
    }
  } finally {
    activeFlushes -= 1;
    if (pending.size) scheduleFlush();
  }
}

function enqueueOne(locale: Locale, text: string): Promise<string> {
  const key = cacheKey(locale, text);
  const hit = cached(key);
  if (hit && looksTranslated(text, hit, locale)) {
    return Promise.resolve(hit);
  }
  // Drop poisoned EN cache entries
  if (hit) {
    mem.delete(key);
    try {
      sessionStorage.removeItem(sessionKey(key));
    } catch {
      /* ignore */
    }
  }

  return new Promise((resolve, reject) => {
    const existing = pending.get(key);
    if (existing) {
      existing.waiters.push({ resolve, reject });
    } else {
      pending.set(key, {
        locale,
        text,
        waiters: [{ resolve, reject }],
      });
    }
    scheduleFlush();
  });
}

async function translateMany(
  locale: Locale,
  texts: string[],
): Promise<string[]> {
  return Promise.all(texts.map((t) => (t ? enqueueOne(locale, t) : Promise.resolve(""))));
}

/**
 * Translate free-text job fields to active locale.
 * EN returns source as-is. Cached in memory + sessionStorage (versioned).
 */
export function useTranslatedText(
  text: string | null | undefined,
  opts?: { enabled?: boolean },
): { text: string; loading: boolean } {
  const { locale } = useI18n();
  const enabled = opts?.enabled !== false;
  const source = (text || "").trim();
  const [out, setOut] = useState(source);
  const [loading, setLoading] = useState(false);

  const key = useMemo(
    () => (source ? cacheKey(locale, source) : ""),
    [locale, source],
  );

  useEffect(() => {
    if (!enabled || !source) {
      setOut(source);
      setLoading(false);
      return;
    }
    if (locale === "en") {
      setOut(source);
      setLoading(false);
      return;
    }
    const hit = cached(key);
    if (hit && looksTranslated(source, hit, locale)) {
      setOut(hit);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const next = await enqueueOne(locale, source);
        if (!cancelled) setOut(next);
      } catch {
        if (!cancelled) setOut(source);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, key, locale, source]);

  return { text: out || source, loading };
}

/** Batch-translate several fields (deduped global queue). */
export function useTranslatedFields<T extends Record<string, string | null | undefined>>(
  fields: T,
  opts?: { enabled?: boolean },
): { values: { [K in keyof T]: string }; loading: boolean } {
  const { locale } = useI18n();
  const enabled = opts?.enabled !== false;
  const entries = useMemo(
    () =>
      Object.entries(fields).map(([k, v]) => [k, (v || "").trim()] as const),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [JSON.stringify(fields)],
  );
  const [values, setValues] = useState(() => {
    const init = {} as { [K in keyof T]: string };
    for (const [k, v] of entries) (init as Record<string, string>)[k] = v;
    return init;
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const init = {} as { [K in keyof T]: string };
    for (const [k, v] of entries) (init as Record<string, string>)[k] = v;
    if (!enabled || locale === "en") {
      setValues(init);
      setLoading(false);
      return;
    }

    const need: string[] = [];
    const resolved: string[] = entries.map(([_, v]) => {
      if (!v) return "";
      const k = cacheKey(locale, v);
      const hit = cached(k);
      if (hit && looksTranslated(v, hit, locale)) return hit;
      need.push(v);
      return v;
    });

    if (!need.length) {
      const next = {} as { [K in keyof T]: string };
      entries.forEach(([k], i) => {
        (next as Record<string, string>)[k] = resolved[i]!;
      });
      setValues(next);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const unique = [...new Set(need)];
        const translated = await translateMany(locale, unique);
        const map = new Map(unique.map((s, i) => [s, translated[i]!]));
        entries.forEach(([_, v], i) => {
          if (!v) return;
          resolved[i] = map.get(v) || v;
        });
      } catch {
        /* keep source */
      } finally {
        if (!cancelled) {
          const next = {} as { [K in keyof T]: string };
          entries.forEach(([k], i) => {
            (next as Record<string, string>)[k] = resolved[i]!;
          });
          setValues(next);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, entries, locale]);

  return { values, loading };
}
