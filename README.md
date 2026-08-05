# APEX // HIRE DESK

Career command center for permanent roles (EU / America).
Stark-ops HUD. Queue-first. Portfolio fit scoring. Copy-ready apply templates.

## Dev

```bash
npm install
npm run dev
```

Open http://localhost:3000 (or `START.bat` → port **3011**).

Access code: `HIRE_DESK_ACCESS_CODE` in `.env.local`, default **APEX-HIRE**.

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
- Manual add + status pipeline + local `data/jobs.json`

## MVP-3 + Individuals + MAX LIVE

- **Individuals** — HR / HM / senior / founder, Access·Leverage·Fit, direct email
- **Harvest MAX LIVE** — Remotive / Arbeitnow / RemoteOK → Greenhouse / Ashby → HTML+proxy
- STOP / live log / segment quotas / cron (`HARVEST_AUTO_CRON=1`)
- LinkedIn **import only** (`data/linkedin_imports.json`)
- Daily apply quotas EU/US + IND; Applied follow-up D3/D7/D14
