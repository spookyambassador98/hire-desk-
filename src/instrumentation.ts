/**
 * Boot hook. In-process auto-cron is disabled here to avoid Webpack
 * bundling node:fs into /instrumentation.
 *
 * Use external cron → POST /api/harvest/cron with Bearer HARVEST_CRON_SECRET
 * (same pattern as Lead Desk Render cron).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.HARVEST_AUTO_CRON === "1") {
    console.log(
      "[boot] HARVEST_AUTO_CRON=1 noted — use POST /api/harvest/cron (Bearer HARVEST_CRON_SECRET); in-process timer disabled in this build",
    );
  }
}
