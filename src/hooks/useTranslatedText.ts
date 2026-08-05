"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n, type Locale } from "@/lib/i18n";

const mem = new Map<string, string>();

function cacheKey(locale: Locale, text: string) {
  return `${locale}::${text.slice(0, 24)}::${text.length}::${hash(text)}`;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(`tr:${key}`);
  } catch {
    return null;
  }
}

function writeSession(key: string, val: string) {
  try {
    sessionStorage.setItem(`tr:${key}`, val);
  } catch {
    /* ignore quota */
  }
}

/**
 * Translate free-text job fields to active locale.
 * EN returns source as-is. Cached in memory + sessionStorage.
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
    const hit = mem.get(key) || readSession(key);
    if (hit) {
      setOut(hit);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale, texts: [source] }),
        });
        const data = (await res.json()) as { texts?: string[] };
        const next = data.texts?.[0]?.trim() || source;
        mem.set(key, next);
        writeSession(key, next);
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

/** Batch-translate several fields with one request. */
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

    const needIdx: number[] = [];
    const resolved: string[] = entries.map(([_, v], i) => {
      if (!v) return "";
      const k = cacheKey(locale, v);
      const hit = mem.get(k) || readSession(k);
      if (hit) return hit;
      needIdx.push(i);
      return v;
    });

    if (!needIdx.length) {
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
        const payload = needIdx.map((i) => entries[i]![1]);
        const res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locale, texts: payload }),
        });
        const data = (await res.json()) as { texts?: string[] };
        needIdx.forEach((i, j) => {
          const src = entries[i]![1];
          const tr = data.texts?.[j]?.trim() || src;
          const k = cacheKey(locale, src);
          mem.set(k, tr);
          writeSession(k, tr);
          resolved[i] = tr;
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
