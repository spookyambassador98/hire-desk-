import { NextResponse } from "next/server";
import { isLocale, type Locale } from "@/lib/i18n/dicts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET: Record<Exclude<Locale, "en">, string> = {
  ru: "ru",
  uk: "uk",
};

/** Process-local cache — survives warm Render instances across requests. */
const cache = new Map<string, string>();
const CACHE_MAX = 2_500;

function cacheKey(locale: Locale, text: string) {
  return `${locale}:${text.length}:${hash(text)}`;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function remember(key: string, val: string) {
  if (cache.size >= CACHE_MAX) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  cache.set(key, val);
}

function chunkText(text: string, max = 900): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const parts: string[] = [];
  let buf = "";
  for (const sentence of t.split(/(?<=[.!?…])\s+/)) {
    if ((buf + " " + sentence).trim().length > max) {
      if (buf) parts.push(buf.trim());
      if (sentence.length > max) {
        for (let i = 0; i < sentence.length; i += max) {
          parts.push(sentence.slice(i, i + max));
        }
        buf = "";
      } else {
        buf = sentence;
      }
    } else {
      buf = buf ? `${buf} ${sentence}` : sentence;
    }
  }
  if (buf.trim()) parts.push(buf.trim());
  return parts;
}

/** Unofficial Google translate endpoint — reliable for UI job text. */
async function googleGtx(text: string, to: string): Promise<string> {
  const url =
    `https://translate.googleapis.com/translate_a/single` +
    `?client=gtx&sl=en&tl=${encodeURIComponent(to)}&dt=t&q=${encodeURIComponent(text)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`gtx HTTP ${res.status}`);
  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error("gtx bad payload");
  }
  const out = (data[0] as unknown[])
    .map((row) => (Array.isArray(row) ? String(row[0] ?? "") : ""))
    .join("")
    .trim();
  if (!out) throw new Error("gtx empty");
  return out;
}

async function myMemory(text: string, to: string): Promise<string> {
  const email = process.env.TRANSLATE_EMAIL?.trim();
  const de = email ? `&de=${encodeURIComponent(email)}` : "";
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${to}${de}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`mymemory HTTP ${res.status}`);
  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
  };
  const out = data.responseData?.translatedText?.trim();
  if (!out || data.responseStatus === 403) throw new Error("mymemory denied");
  if (/MYMEMORY WARNING/i.test(out)) throw new Error("mymemory limit");
  return out;
}

async function translateChunk(text: string, to: string): Promise<string> {
  try {
    return await googleGtx(text, to);
  } catch {
    try {
      return await myMemory(text, to);
    } catch {
      return text;
    }
  }
}

async function translateOne(text: string, locale: Locale): Promise<string> {
  const src = text.trim();
  if (!src || locale === "en") return text;
  const key = cacheKey(locale, src);
  const hit = cache.get(key);
  if (hit) return hit;

  const to = TARGET[locale];
  const chunks = chunkText(src);
  const out: string[] = [];
  for (const c of chunks) {
    out.push(await translateChunk(c, to));
  }
  const joined = out.join(" ").trim() || src;
  remember(key, joined);
  return joined;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      locale?: string;
      texts?: string[];
    };
    const locale = body.locale;
    if (!isLocale(locale)) {
      return NextResponse.json({ error: "bad_locale" }, { status: 400 });
    }
    const texts = Array.isArray(body.texts) ? body.texts.slice(0, 12) : [];
    // Sequential within request keeps upstream calm; parallel cards use client queue.
    const translated: string[] = [];
    for (const t of texts) {
      translated.push(
        await translateOne(String(t || "").slice(0, 3500), locale),
      );
    }
    return NextResponse.json({ locale, texts: translated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: msg.slice(0, 160), texts: [] },
      { status: 200 },
    );
  }
}
