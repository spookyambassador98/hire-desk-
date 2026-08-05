import { arbeitnowSource } from "./arbeitnow";
import { ashbySource } from "./ashby";
import { greenhouseSource } from "./greenhouse";
import { htmlBoardsSource } from "./htmlBoards";
import { linkedinImportSource } from "./linkedinImport";
import { remoteokSource } from "./remoteok";
import { remotiveSource } from "./remotive";
import type { JobSource } from "./types";

export const ALL_JOB_SOURCES: JobSource[] = [
  remotiveSource,
  arbeitnowSource,
  remoteokSource,
  greenhouseSource,
  ashbySource,
  htmlBoardsSource,
  linkedinImportSource,
];

export function sourcesByTier(
  tier: JobSource["tier"],
): JobSource[] {
  return ALL_JOB_SOURCES.filter((s) => s.tier === tier && s.enabled());
}

export function enabledSources(): JobSource[] {
  return ALL_JOB_SOURCES.filter((s) => s.enabled());
}
