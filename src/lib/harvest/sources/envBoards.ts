import { env } from "@/lib/env";

export function envBoardList(
  name: string,
  fallback: string,
): string[] {
  return (env(name) || fallback)
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
