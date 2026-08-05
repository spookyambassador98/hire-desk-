/**
 * Smoke-check Fit / Reach / Priority against sample jobs.
 * Run: npm run score:samples
 * (Node 22+ with --experimental-strip-types)
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Dynamic import via file URL so Node resolves .ts under strip-types
const scoringUrl = pathToFileURL(
  join(__dirname, "../src/lib/scoring.ts"),
).href;
const templatesUrl = pathToFileURL(
  join(__dirname, "../src/lib/templates.ts"),
).href;

const { enrichJobProofs, scoreJob } = await import(scoringUrl);
const { renderApply, renderTemplate } = await import(templatesUrl);

const sample = JSON.parse(
  readFileSync(join(__dirname, "../data/jobs.sample.json"), "utf8"),
);

const ctx = {
  europeQuotaRemaining: 8,
  americaQuotaRemaining: 10,
  now: "2026-08-05T12:00:00.000Z",
};

for (const raw of sample) {
  const job = enrichJobProofs(raw);
  const { fit, reach, priority } = scoreJob(job, ctx);

  console.log("\n===", job.company, "—", job.role);
  console.log(
    `Fit ${fit.score} (${fit.band})${fit.antiFiltered ? ` ANTI: ${fit.antiFilterReason}` : ""}`,
  );
  for (const b of fit.breakdown) {
    console.log(
      `  · ${b.label}: ${b.points}/${b.max}${b.note ? ` — ${b.note}` : ""}`,
    );
  }
  console.log(`Reach ${reach.score}`);
  console.log(`Priority ${priority.score}`);
  console.log(
    "Proofs:",
    job.proofProjects?.map((p) => p.name).join(", ") || "(none)",
  );
  if (!fit.antiFiltered) {
    console.log("--- apply preview ---");
    console.log(renderApply(job).slice(0, 420) + "…");
    if (job.status === "queued") {
      console.log("--- interview brief (head) ---");
      console.log(renderTemplate("interview_brief", job).slice(0, 360) + "…");
    }
  }
}

void createRequire;
