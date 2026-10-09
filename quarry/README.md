# Quarry — evidence-first investing research

Quarry is a mobile-first research platform for self-directed investors. It turns official SEC EDGAR disclosures (13F, Form 4, 8-K, Schedule 13D/13G, XBRL company facts) into ranked research candidates, and for every candidate it answers three questions:

1. **What is happening?**
2. **Why might it matter?**
3. **What evidence supports that?** (filings, timestamps, source links, limitations)

Quarry does **not** give investment advice, predict prices, promise returns or execute trades. Rankings show what to research first, not what will perform.

---

## Features

| Area | What it does |
|---|---|
| **Home** | Since your last visit (session-based), Radar highlights, Watchlist activity, Recently filed, Research shortcuts |
| **Opportunity Radar** | 8 categories in two modes. *Positioning* (13F): accumulation, new positions, broad-based interest, reduction. *Event & swing*: insider buying, activist (13D), 8-K event watch, unusual market activity. Filters: mode, category, sector, market cap, form, filed-date range, reporting period, institutional/insider/market confirmation, watchlist. Each card expands to show what changed, why it matters, what to verify, every supporting disclosure, the ranking calculation and its limitations. |
| **Transparent ranking** | `priority = 100 × Σ(weight × normalised input) ÷ Σ(weight of available inputs)`. Every input lists its raw value, its formula and its weight. Missing inputs are listed and left out of both sums, and coverage is shown. Results depend only on the cutoff, so they are reproducible. The same disclosure is never counted twice: one count per manager or insider, amendments merged. |
| **Explore** | 9 presets (new positions, broad adds, largest share-count increases, largest weight increases, insider purchases, reductions, activist, event watch, watchlist) with search, sector filter, sort, pagination and "why it qualified" evidence |
| **Investor profiles** | CIK, period switcher, acceptance time, amendments applied, new/increased/reduced/exited, concentration, derived weights, value change split into share-driven and price-driven parts, multi-period share history, filing list |
| **Stock pages** | Ownership overview, institutional changes, breadth, Form 4 activity with correct code classes, 8-K/13D/13G events, market context and chart (with a provider), XBRL fundamentals, evidence timeline |
| **Compare** | 2–4 investors (overlap, counts, concentration, sector exposure) or stocks (breadth, insider activity, events, fundamentals, price, derived P/E), laid out as mobile cards |
| **Watchlist & alerts** | Follow stocks, managers and Radar categories. Alert rules (create/edit/pause/delete) for new filings, new 13F positions, material share-count changes, insider purchases, 13D/13G and selected 8-K items. Each alert shows trigger, source, filing acceptance, detection time, per-channel delivery outcome and limitations. Alerts are deduplicated. |
| **Data trust** | Every record is labelled Recently filed / Historical / Market data / Demo / Unavailable / Stale with a reason. A platform-wide **historical view** (as-of cutoff) is available in Settings. |

### Distinct timestamps (kept separate in the DB, the API and the UI)

`period_of_report` · `transaction_date` · `event_date` · `filing_date` · `accepted_at` (EDGAR acceptance, the disclosure time) · `ingested_at` · market `observed_at` · ranking `computedAt` / `asOf`.

### Domain rules enforced in code (and covered by tests)

- **13F**: share counts classify a change, not value. Every value change is split into a share-count part and a price part, and the two always add up to the total. Option (PUT/CALL) and principal (PRN) rows are excluded from share counts and weights. Before 2023-01-03 values were reported in thousands, after that in dollars, and both are handled. A RESTATEMENT amendment replaces earlier filings; a NEW HOLDINGS amendment adds to them. Both apply only from their own acceptance time.
- **Form 4**: all 20 SEC transaction codes are mapped. A *qualifying* open-market purchase means code P, non-derivative, acquired, with a price, and not under a 10b5-1 plan. Awards (A), exercises (M/X/O), tax withholding (F), gifts (G) and derivative P/S are never counted as purchases. A 4/A replaces the earlier filing for the same issuer, owner and period, but only once accepted. Duplicate submissions are counted once.
- **8-K**: item taxonomy with documented editorial relevance weights. An 8-K/A is merged with its original event.
- **Look-ahead protection**: every query takes `asOf`. Only filings accepted on or before the cutoff and price bars dated on or before it are used. Amendments are never applied before their acceptance.
- **Identity**: CIK for entities and CUSIP for 13F securities. Tickers are for display only. CUSIPs not in the universe are kept and flagged `unmapped`, never silently joined to a stock.

---

## Architecture

```
quarry/
├── server/                 Node 22 + Express 5 (TypeScript, run with tsx)
│   ├── app.ts              REST API, workspace cookie, validation (zod), static client
│   ├── db/                 SQLite via built-in node:sqlite (no native build); schema.sql
│   ├── sec/                EDGAR client (rate limit, retry, User-Agent), parsers, idempotent store, ingestion
│   ├── domain/             13F resolution & changes, Form 4 codes, events, freshness, ranking, radar, explore, alerts, profiles
│   ├── market/             Market-data adapter: demo | polygon | alphavantage | none
│   ├── demo/               Deterministic fictional dataset generated through the production parsers
│   └── cli/                seed-demo, ingest, evaluate-alerts
├── shared/types.ts         Types shared by API and client
├── src/                    React 19 + React Router 7 + Vite; hand-built CSS design system
├── tests/                  Vitest unit + integration tests (88)
├── e2e/run.mjs             Playwright-core browser journeys at 360 / 430 / 1280 px
└── config/universe.json    Tracked managers, issuers and CUSIP mappings for live ingestion
```

**Personal data scoping.** Watchlists, alert rules, alerts, preferences and visit history belong to a *workspace*. The workspace is identified by a random 128-bit ID in an `HttpOnly; SameSite=Lax` cookie (`Secure` in production). Every query filters on it on the server. There are no user accounts, no subscriptions and no paywall. If you add accounts, replace the cookie workspace with authenticated user IDs, and enforce any entitlements on the server.

**Storage.** SQLite with WAL. Each filing is keyed by accession number. Re-ingesting identical content does nothing. A changed parser version or changed content triggers a re-parse inside a transaction, and the correction is logged in `parse_runs` with the number of rows it replaced. Amendments are stored as separate filings and never overwrite originals. Ingestion runs and errors are logged in `ingestion_log` and `ingestion_errors`.

---

## Setup

Requirements: **Node.js ≥ 22.5** (uses the built-in `node:sqlite`). No database server is needed.

```bash
cd quarry
npm install
cp .env.example .env        # optional; defaults run the demo
```

### Development

```bash
npm run dev                 # API on :8787 (tsx watch) + Vite on :5173 with /api proxy
```

Open http://localhost:5173. On first start in demo mode the server seeds `data/demo.db`.

### Production build

```bash
npm run build               # typecheck + vite build → dist/
npm start                   # serves API + dist/ on $PORT (default 8787)
```

### Tests

```bash
npm test                    # 88 Vitest tests (parsers, amendments, look-ahead, codes, freshness, ranking, alerts, ingestion, API)
npm run build && npm run test:e2e   # 13 browser checks × 3 viewports (needs Chromium; set CHROMIUM_PATH if not under /opt/pw-browsers)
```

---

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `QUARRY_DATASET` | `demo` | `demo` (fictional, `data/demo.db`) or `sec` (official data, `data/quarry.db`) |
| `QUARRY_DB_PATH` | per dataset | Override the SQLite path |
| `SEC_USER_AGENT` | — | **Required for ingestion.** `"Company Name contact@example.com"`, per the SEC fair-access policy |
| `SEC_MAX_RPS` | `8` | Request rate (capped at 10/s) |
| `QUARRY_UNIVERSE` | `./config/universe.json` | Tracked managers, issuers and CUSIPs |
| `MARKET_DATA_PROVIDER` | `none` | `none`, `polygon` or `alphavantage` (ignored in demo mode, which uses simulated prices) |
| `MARKET_DATA_API_KEY` | — | Provider key (server-side only; never sent to the client) |
| `MARKET_DATA_DELAY_MINUTES` | `15` | Declared delay of your data plan |
| `ALERT_WEBHOOK_URL` | — | Optional relay for email/push. An alert counts as "sent" only on a 2xx response from the relay |

## SEC data configuration and ingestion

```bash
export QUARRY_DATASET=sec SEC_USER_AGENT="Acme Research ops@acme.example"
npm run ingest                        # 13F + events + fundamentals for config/universe.json
npm run ingest -- events              # only Form 4 / 8-K / 13D / 13G
npm run ingest -- 13f                 # only 13F (last `periodsBack` quarters per manager)
npm run alerts:evaluate               # re-run alert rules (ingest also does this)
QUARRY_DATASET=sec npm start
```

Sources (all official SEC endpoints): `data.sec.gov/submissions/CIK##########.json`, the filing indexes and documents under `www.sec.gov/Archives/edgar/data/…`, the SGML `-index-headers.html` (for the 13D/G filer), and `data.sec.gov/api/xbrl/companyfacts`. Ingestion is idempotent and safe to schedule (for example hourly via cron). For a backfill, raise `periodsBack` and `lookbackDays` in the universe file. Edit `config/universe.json` to track more managers and issuers, and add each issuer's CUSIPs so 13F rows map to stocks. Verify CIKs and CUSIPs against EDGAR before relying on them. Names are refreshed from SEC on every ingest, which exposes a mismatched CIK.

The server refuses to mix datasets: SEC mode will not open a demo database, and ingestion will not write into one.

## Market-data provider

Interface: `server/market/provider.ts` (`status()`, `getHistory()`, `getQuote()`). Adapters for Polygon.io aggregates and Alpha Vantage daily-adjusted bars are included. Every adapter drops bars after the cutoff, labels its delay and returns `null` rather than invented values. With no provider in SEC mode, price, chart, valuation and unusual-activity features show **Unavailable** with an explanation, and the rest of the app keeps working. To add a provider, implement the interface and register it in `server/market/index.ts`.

## Deployment considerations

- Single Node process plus one SQLite file. Mount `data/` on persistent storage, put it behind HTTPS (`NODE_ENV=production` sets `Secure` cookies), and run ingestion on a schedule.
- For multiple instances, move to Postgres. The SQL is portable apart from `INSERT … ON CONFLICT` details and node:sqlite.
- Keep API keys in the server environment only. The client never receives them.

## Known limitations

- **No live SEC verification in this environment.** The development sandbox's network policy blocked `data.sec.gov` and `www.sec.gov`, so ingestion was verified with EDGAR-format fixtures and a mocked EDGAR, not against live endpoints.
- EDGAR's `acceptanceDateTime` is treated as Eastern wall-clock time and converted to UTC. This matches observed EDGAR behaviour, but verify it against live data.
- Schedule 13D/G parsing reads the structured XML format (required since Dec 2024) by field-name pattern. Older HTML/text schedules are stored header-only, without a percentage.
- 8-K bodies are not parsed. Item codes come from EDGAR metadata.
- CUSIP→issuer mapping comes from the universe file. Name matching is a flagged fallback.
- Market cap in SEC mode is not computed (it needs shares outstanding × a licensed price). Fundamentals cover a small set of XBRL concepts.
- 8-K relevance weights and ranking weights are editorial choices. They are documented, not fitted to returns.
- No accounts, email or push provider is bundled. In-app alerts work out of the box, and the webhook adapter is the integration point.

## Demo data disclosure

Demo mode is the default. **Every company, manager, person, filing, price and fundamental in it is fictional.** Names carry "(Demo)", CIKs use the unused 9xxxxxxxxx range, there are no SEC source links, and every screen shows Demo badges and banners. The seeder writes EDGAR-format XML and runs it through the production parsers and store. That gives realistic scenarios: amendments (restatement, new-holdings, 4/A, 8-K/A), awards, exercises, gifts, 10b5-1 purchases and price-driven value changes. Demo prices are simulated and are never shown alongside SEC data.
