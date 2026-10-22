# Wheel Command

Wheel Strategy & options income scanner. It scans a whole index, ranks the best risk-adjusted cash-secured puts and covered calls, and tracks the full Wheel lifecycle with income analytics.

**Scanner → Opportunities → My Wheel → Income → Settings**

- **Scanner**: pick S&P 100, NASDAQ 100, NYSE 100 or Dow Jones 30, then CSP, CC or both. Set capital, expiration window, monthly income target and risk tolerance, and scan with one click.
- **Opportunities**: the top 10–20 candidates, each with a 0–100 Opportunity Score, a verdict (Strong Candidate / Favorable / Watch / Avoid) and Conservative / Balanced / Aggressive strikes. Each card shows the full contract metrics, risk-neutral probabilities, assignment risk, a score breakdown down to individual points, and the reasons the trade qualifies.
- **My Wheel**: CSP → assignment → shares → covered call → called away → repeat. Covers rolls, buy-to-close, buy-writes, adjusted cost basis, mark-to-market and undo.
- **Income**: weekly, monthly and yearly net premium, realized P/L, available capital, upcoming expirations, completed cycles, a 12-month chart and a full trade journal with CSV export.

## Data integrity

All market data comes from **Massive.com** (formerly Polygon.io) through the serverless API. The API key stays on the server.

- When a symbol is missing price history, an options chain, bid/ask quotes, delta or IV, it is marked **Unverified**. It gets no score and no probability.
- When a secondary input is missing (fundamentals, earnings date, dividends), that component is left out of the score and the remaining weights are re-normalized. The card shows "n/a" or "Unavailable" for it.
- Probabilities are Black-Scholes risk-neutral N(d₂) values computed from each contract's own implied volatility. They describe how the market prices the option. They are not forecasts.

## Scoring

| Component | Weight | Inputs |
|---|---|---|
| Trend | 20% | price vs 50/200-day SMA, 50 > 200, 50-day slope, distance from 52-week high |
| Quality | 15% | market cap, 1-year realized vol, 1-year max drawdown, TTM profitability |
| Liquidity | 20% | open interest, volume, bid/ask spread % |
| Income | 20% | monthly-equivalent return on collateral vs your target |
| Risk | 25% | prob. OTM, break-even vs 1σ expected move, IV/HV20, earnings (and ex-dividend for calls) before expiry |
| Regime | ±pts | SPY vs 50/200-day SMA and 20-day volatility |

Verdicts: ≥75 Strong Candidate, ≥62 Favorable, ≥48 Watch, otherwise Avoid. Two conditions cap the verdict at Watch: earnings before expiry, and a put on a stock trading below both its 50- and 200-day averages.

Strike tiers by |Δ|: Conservative 0.08–0.20, Balanced 0.18–0.30, Aggressive 0.28–0.42. A contract must be out of the money, quoted, and within your open-interest, spread, expiration and capital limits.

## Deploy on Vercel

1. Import the repository in Vercel and set **Root Directory** to `wheel-command`. Framework preset: *Other*. No build command is needed.
2. Add the environment variable `MASSIVE_API_KEY`. Scanning needs a Massive plan that includes **options snapshots with quotes and Greeks** plus **stocks aggregates**. The earnings calendar (`/benzinga/v1/earnings`) is optional.
3. Deploy. **Settings → Market data → Test connection** shows which entitlements your key can reach.

Optional variables: `MASSIVE_BASE_URL` (default `https://api.massive.com`) and `MASSIVE_MAX_CONCURRENCY` (default 8 upstream requests per instance).

## API

| Route | Purpose |
|---|---|
| `GET /api/universe[?market=]` | index lists |
| `GET /api/analyze?symbol=&strategy=csp\|cc\|both&risk=&dteMin=&dteMax=&capital=&target=&minOI=&maxSpread=&rate=[&basis=]` | full analysis of one underlying |
| `GET /api/market` | SPY-based market regime |
| `GET /api/quotes?symbols=A,B` | latest daily close for holdings |
| `GET /api/health` | key configured and entitlement probe (never returns the key) |

The browser runs each scan with 4 concurrent requests to `/api/analyze`, shows progress and can be cancelled. The server side provides:

- TTL caching with in-flight de-duplication, plus CDN `s-maxage` headers
- bounded upstream concurrency
- retry with backoff on 429/5xx responses
- timeouts
- per-IP rate limiting
- input validation

## Local development

```bash
cd wheel-command
cp .env.example .env        # add your MASSIVE_API_KEY
npm run dev                 # http://localhost:3000
npm test                    # engine, API and ledger tests
```

The tests use `tests/mock-upstream.js`, a synthetic, test-only stand-in for the Massive API. It is never loaded in production.

Wheel data (trades, journal, settings and the last scan) is stored in the browser's localStorage. Use **Settings → Export backup** to keep a copy or move it to another device.

> Analytics only, not investment advice. Options carry substantial risk.
