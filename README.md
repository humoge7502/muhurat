# Muhurat — never miss your moment

**A real-time opportunity radar for students.** Contests, hackathons and
scholarships ingested live from public keyless sources, deduplicated, ranked by
deadline, and turned into reminders that reach your phone even offline.

> Every item is real and links to its source. Nothing simulated — the footer of
> the app says so, and the snapshots in `data/snapshots/` prove what was fetched
> and when.

## What works right now (verified end-to-end)

| Capability | How it works |
|---|---|
| Live ingestion | Three keyless public sources: Codeforces contests API, Devpost hackathons API, Opportunity Desk RSS. Refresh on startup + every 6 h + on demand. |
| Real deadlines | Parsed from each source's actual dates (cross-month and same-month ranges); unparseable dates show **"see source"** honestly, never a guess. |
| Countdown chips | Amber < 3 days, rose < 24 h — visible the moment a card renders. |
| Reminders that work | Save an item → export the `.ics` calendar (with 48 h device alarms) → your phone reminds you even with the app closed. |
| Guided tour | A 5-step aurora-themed tour (driver.js) runs on first visit and can be replayed from the header. |
| Installable PWA | Manifest + service worker: installable from Chrome/Edge, shell cached, API responses cached for offline reads. |
| Provenance | Every fetch writes a raw snapshot to `data/snapshots/`; source status (ok/count/error) is visible in the API and UI footer. |

Verified on this machine (2026-10-29): 28 live items (9 contests + 9 hackathons
+ 10 scholarships), 24 with parsed deadlines, Chromium-driven screenshots in
`docs/assets/`, a recorded walkthrough video in `docs/assets/video/`, and the
`.ics` endpoint returning real calendar events with alarms.

## Run it

```bash
# backend (ingests real data on startup)
cd backend
pip install -r requirements.txt
python -m uvicorn backend.app:app --port 8899 --app-dir ..

# frontend
cd ../frontend
npm install
npm run dev            # http://127.0.0.1:5175
```

## API

| Endpoint | Purpose |
|---|---|
| `GET /api/opportunities?q=&type=&days=&sort=` | Filtered, deadline-sorted feed |
| `POST /api/refresh` | Pull all sources now |
| `GET /api/ics?ids=` | Calendar file with alarms for the given items |
| `GET /api/health` | Source status + counts |

## Design system

Dark-first **midnight aurora**: fixed multi-radial background (violet → cyan →
amber), glass cards with hover lift, gradient wordmark, spring physics via
Motion, Lucide icons, reduced-motion respected.

## Docs

- [`BUSINESS.md`](BUSINESS.md) — the market research, the model, the moat
- [`PLAYSTORE.md`](PLAYSTORE.md) — the exact path to Google Play (and what only
  the account owner can do)
- [`docs/assets/`](docs/assets/) — screenshots + recorded walkthrough

## License

MIT.
