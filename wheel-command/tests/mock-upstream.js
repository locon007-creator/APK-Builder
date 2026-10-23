// TEST-ONLY: replaces global fetch for Massive API URLs with deterministic
// synthetic responses shaped like the real API. Loaded only by tests and by
// the dev server when WHEEL_MOCK_UPSTREAM is set explicitly. Never deployed.

import { normCdf } from '../api/_lib/engine.js';

process.env.MASSIVE_API_KEY ||= 'test-key';
const realFetch = globalThis.fetch;

function rng(seed) {
  let x = 0;
  for (const ch of seed) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const isoPlus = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

// Symbols with special behavior
const NO_OPTIONS = new Set(['MMM']); // options endpoint 403 → Unverified
const NO_QUOTES = new Set(['KO']); // chain without bid/ask → Unverified
const DOWNTREND = new Set(['INTC', 'BA']);
const EARNINGS_SOON = new Set(['AAPL', 'NKE']);

function bars(sym) {
  const r = rng(sym);
  let p = 50 + r() * 400;
  const kind = r();
  const drift = DOWNTREND.has(sym) || kind < 0.22 ? -0.0011 : kind < 0.4 ? 0.0001 : 0.0005 + r() * 0.0006;
  const noise = 0.018 + r() * 0.03;
  const out = [];
  const start = Date.now() - 400 * 86400000;
  for (let i = 0; i < 275; i++) {
    p *= Math.exp(drift + (r() - 0.5) * noise * 2);
    out.push({ t: start + i * 1.45 * 86400000, o: p, h: p * 1.01, l: p * 0.99, c: Math.round(p * 100) / 100, v: 1e6 + r() * 5e6 });
  }
  return out;
}

function bsPrice(S, K, T, iv, type) {
  const d1 = (Math.log(S / K) + 0.5 * iv * iv * T) / (iv * Math.sqrt(T));
  const d2 = d1 - iv * Math.sqrt(T);
  return type === 'call' ? { p: S * normCdf(d1) - K * normCdf(d2), delta: normCdf(d1) } : { p: K * normCdf(-d2) - S * normCdf(-d1), delta: normCdf(d1) - 1 };
}

function chain(sym, q) {
  const b = bars(sym);
  const S = b[b.length - 1].c;
  const r = rng(sym + 'opt');
  const baseIv = 0.2 + r() * 0.25;
  const type = q.get('contract_type');
  const lo = Number(q.get('strike_price.gte'));
  const hi = Number(q.get('strike_price.lte'));
  const eFrom = q.get('expiration_date.gte');
  const eTo = q.get('expiration_date.lte');
  const step = S > 200 ? 5 : S > 50 ? 2.5 : 1;
  const results = [];
  for (const dte of [9, 16, 23, 30, 37, 44, 58]) {
    const exp = isoPlus(dte);
    if (exp < eFrom || exp > eTo) continue;
    for (let k = Math.ceil(lo / step) * step; k <= hi; k += step) {
      const T = dte / 365;
      const iv = baseIv * (1 + (type === 'put' ? 0.25 : 0.05) * Math.max(0, (S - k) / S) * 4);
      const { p, delta } = bsPrice(S, k, T, iv, type);
      if (p < 0.05) continue;
      const spread = Math.max(0.02, p * (0.015 + r() * (sym.charCodeAt(0) % 3 === 0 ? 0.16 : 0.06)));
      const oi = Math.round(50 + r() * 6000 * Math.exp(-Math.abs(S - k) / S / 0.08));
      results.push({
        details: { contract_type: type, exercise_style: 'american', expiration_date: exp, shares_per_contract: 100, strike_price: k, ticker: `O:${sym}${exp}${type[0]}${k}` },
        greeks: { delta, gamma: 0.01, theta: -0.05, vega: 0.1 },
        implied_volatility: iv,
        open_interest: oi,
        day: { volume: Math.round(oi * r() * 0.3), close: p },
        last_quote: NO_QUOTES.has(sym) ? undefined : { bid: Math.max(0.01, p - spread / 2), ask: p + spread / 2, midpoint: p, last_updated: Date.now() * 1e6 },
        underlying_asset: { price: S, ticker: sym },
      });
    }
  }
  const page = Number(q.get('cursor') || 0);
  const slice = results.slice(page * 250, page * 250 + 250);
  const more = results.length > (page + 1) * 250;
  return { status: 'OK', results: slice, next_url: more ? `https://api.massive.com/v3/snapshot/options/${sym}?cursor=${page + 1}&${[...q].filter(([k]) => k !== 'cursor').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&')}` : undefined };
}

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status, message) => new Response(JSON.stringify({ status: 'ERROR', message }), { status, headers: { 'content-type': 'application/json' } });

export const calls = [];

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!/massive\.com$/.test(url.hostname)) return realFetch(input, init);
  calls.push(url.pathname);
  const p = url.pathname;
  let m;
  if ((m = p.match(/^\/v2\/aggs\/ticker\/([^/]+)\/range\//))) return ok({ results: bars(decodeURIComponent(m[1])) });
  if ((m = p.match(/^\/v2\/aggs\/ticker\/([^/]+)\/prev$/))) return ok({ results: [bars(decodeURIComponent(m[1])).at(-1)] });
  if ((m = p.match(/^\/v3\/reference\/tickers\/(.+)$/))) {
    const s = decodeURIComponent(m[1]);
    return ok({ results: { name: `${s} Holdings Inc.`, market_cap: 2e10 + rng(s)() * 2e12, sic_description: 'Synthetic test sector' } });
  }
  if (p === '/vX/reference/financials') return ok({ results: [{ fiscal_period: 'TTM', financials: { income_statement: { net_income_loss: { value: DOWNTREND.has(url.searchParams.get('ticker')) ? -1e8 : 5e9 }, revenues: { value: 6e10 } } } }] });
  if (p === '/v3/reference/dividends') return ok({ results: [{ ex_dividend_date: isoPlus(20), cash_amount: 0.25 }] });
  if (p === '/benzinga/v1/earnings') {
    const t = url.searchParams.get('ticker');
    return ok({ results: EARNINGS_SOON.has(t) ? [{ ticker: t, date: isoPlus(12) }] : [{ ticker: t, date: isoPlus(70) }] });
  }
  if ((m = p.match(/^\/v3\/snapshot\/options\/(.+)$/))) {
    const s = decodeURIComponent(m[1]);
    if (NO_OPTIONS.has(s)) return fail(403, 'You are not entitled to this data.');
    return ok(chain(s, url.searchParams));
  }
  return fail(404, 'Not found');
};
