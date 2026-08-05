# APEX // HIRE DESK

Career command center for permanent roles (EU / America).
Stark-ops HUD. Queue-first. Portfolio fit scoring. Copy-ready apply templates.

## Dev

```bash
npm install
npm run dev
```

Open http://localhost:3000 (or `START.bat` → port **3011**).

Access code: set `HIRE_DESK_ACCESS_CODE` in `.env.local` (required).

`data/jobs.sample.json` is **fixtures only** for `npm run score:samples` — not loaded into the app.

## Scoring (lib)

Transparent three-number model in `src/lib/`:

- **Fit** — role + portfolio proof + company signal + stack + comp
- **Reach** — apply URL + recruiter contact
- **Priority** — sort key for Queue (`Fit×0.55 + Reach×0.25 + freshness + quota − penalty`)

```bash
npm run score:samples
```

## MVP-1 (live)

- Queue / Europe / America / Applied / Templates
- Job cards: Fit · Reach · Priority, proofs, copy apply / brief
- Manual add + status pipeline + local `data/jobs.json` or `HIRE_STORAGE=firebase`

## MVP-3 + Individuals + MAX LIVE

- **Individuals** — HR / HM / senior / founder, Access·Leverage·Fit, direct email
- **Harvest MAX LIVE** — Remotive / Arbeitnow / RemoteOK / HN / GitHub → Greenhouse / Ashby / Lever / SmartRecruiters / Workable → HTML+proxy / Telegram (opt-in)
- STOP / live log / segment quotas / external cron (`POST /api/harvest/cron`)
- LinkedIn **import only** (`data/linkedin_imports.json`)
- Daily apply quotas EU/US + IND; Applied follow-up D3/D7/D14
