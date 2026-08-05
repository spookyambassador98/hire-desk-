/**
 * Runtime env reader — bracket access so Next.js does NOT inline
 * empty values at build time.
 */
export function env(name: string, fallback = ""): string {
  try {
    const v = process.env[name];
    if (v == null) return fallback;
    return String(v).trim();
  } catch {
    return fallback;
  }
}

export function envNum(name: string, fallback: number): number {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** SOURCES_*=0 → off. Unset → defaultOn. */
export function envSourceOn(name: string, defaultOn = true): boolean {
  const v = env(name);
  if (!v) return defaultOn;
  return v !== "0" && v.toLowerCase() !== "false" && v !== "off";
}
