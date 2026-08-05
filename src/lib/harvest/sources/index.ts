import { arbeitnowSource } from "./arbeitnow";
import { ashbySource } from "./ashby";
import { githubSource } from "./github";
import { greenhouseSource } from "./greenhouse";
import { hackernewsSource } from "./hackernews";
import { htmlBoardsSource } from "./htmlBoards";
import { leverSource } from "./lever";
import { linkedinImportSource } from "./linkedinImport";
import { remoteokSource } from "./remoteok";
import { remotiveSource } from "./remotive";
import { smartrecruitersSource } from "./smartrecruiters";
import { telegramSource } from "./telegram";
import { workableSource } from "./workable";
import type { JobSource } from "./types";

export const ALL_JOB_SOURCES: JobSource[] = [
  remotiveSource,
  arbeitnowSource,
  remoteokSource,
  hackernewsSource,
  githubSource,
  greenhouseSource,
  ashbySource,
  leverSource,
  workableSource,
  smartrecruitersSource,
  htmlBoardsSource,
  telegramSource,
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
