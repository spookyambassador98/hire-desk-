import { NextResponse } from "next/server";
import { isLocale, type Locale } from "@/lib/i18n/dicts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGET: Record<Exclude<Locale, "en">, string> = {
  ru: "ru",
  uk: "uk",
};

function chunkText(text: string, max = 420): string[] {
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

async function myMemory(text: string, to: string): Promise<string> {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|${to}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`translate HTTP ${res.status}`);
  const data = (await res.json()) as {
    responseData?: { translatedText?: string };
    responseStatus?: number;
  };
  const out = data.responseData?.translatedText?.trim();
  if (!out || data.responseStatus === 403) return text;
  // MyMemory sometimes returns QUERY LENGTH LIMIT NOTICE
  if (/MYMEMORY WARNING/i.test(out)) return text;
  return out;
}

async function translateOne(text: string, locale: Locale): Promise<string> {
  if (!text.trim() || locale === "en") return text;
  const to = TARGET[locale];
  const chunks = chunkText(text);
  const out: string[] = [];
  for (const c of chunks) {
    try {
      out.push(await myMemory(c, to));
      await new Promise((r) => setTimeout(r, 80));
    } catch {
      out.push(c);
    }
  }
  return out.join(" ").trim() || text;
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
    const translated = await Promise.all(
      texts.map((t) => translateOne(String(t || "").slice(0, 3500), locale)),
    );
    return NextResponse.json({ locale, texts: translated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: msg.slice(0, 160), texts: [] },
      { status: 200 },
    );
  }
}
