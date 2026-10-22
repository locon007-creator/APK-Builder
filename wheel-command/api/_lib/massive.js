// Massive.com (formerly Polygon.io) REST client with in-memory TTL caching,
// in-flight de-duplication, bounded concurrency, timeouts and retry/backoff.
// The API key is read from the server environment only and never returned.

const BASE = (process.env.MASSIVE_BASE_URL || 'https://api.massive.com').replace(/\/$/, '');
const MAX_CONCURRENCY = Number(process.env.MASSIVE_MAX_CONCURRENCY) || 8;
const TIMEOUT_MS = 12000;
const MAX_ENTRIES = 3000;

export class UpstreamError extends Error {
  constructor(message, status, path) {
    super(message);
    this.status = status;
    this.path = path;
  }
}

export const hasKey = () => Boolean(process.env.MASSIVE_API_KEY);

const cache = new Map(); // key -> { expires, promise }

let active = 0;
const queue = [];
async function withSlot(fn) {
  if (active >= MAX_CONCURRENCY) await new Promise((r) => queue.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    queue.shift()?.();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rawFetch(url, path) {
  const key = process.env.MASSIVE_API_KEY;
  if (!key) throw new UpstreamError('MASSIVE_API_KEY is not configured on the server', 503, path);
  let attempt = 0;
  for (;;) {
    const res = await withSlot(() =>
      fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) }),
    ).catch((e) => {
      throw new UpstreamError(e.name === 'TimeoutError' ? 'Data provider timed out' : 'Data provider unreachable', 504, path);
    });
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < 3) {
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 8000) : 500 * 2 ** attempt + Math.random() * 250);
      attempt++;
      continue;
    }
    let msg = `Data provider returned ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message || body?.error) msg = String(body.message || body.error).slice(0, 200);
    } catch {}
    throw new UpstreamError(msg, res.status, path);
  }
}

function buildUrl(path, params = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
}

export async function get(path, params, ttlSec) {
  const url = buildUrl(path, params);
  const now = Date.now();
  const hit = cache.get(url);
  if (hit && hit.expires > now) return hit.promise;
  const promise = rawFetch(url, path);
  cache.set(url, { expires: now + ttlSec * 1000, promise });
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
  promise.catch((e) => {
    // Cache hard failures briefly (avoid hammering a 403/404), drop transient ones.
    const entry = cache.get(url);
    if (entry?.promise === promise) {
      if (e.status === 403 || e.status === 404) entry.expires = Date.now() + 10 * 60 * 1000;
      else cache.delete(url);
    }
  });
  return promise;
}

// Follows next_url pagination (cursor-based) up to maxPages.
export async function getAll(path, params, ttlSec, maxPages = 4) {
  const first = await get(path, params, ttlSec);
  const results = [...(first.results || [])];
  let next = first.next_url;
  let pages = 1;
  while (next && pages < maxPages) {
    const u = new URL(next);
    const page = await get(u.pathname, Object.fromEntries(u.searchParams), ttlSec);
    results.push(...(page.results || []));
    next = page.next_url;
    pages++;
  }
  return { results, truncated: Boolean(next) };
}

// ---------- typed helpers ----------

export function nyDate(offsetDays = 0, from = new Date()) {
  const d = new Date(from.getTime() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export async function dailyBars(symbol, days = 400) {
  const data = await get(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${nyDate(-days)}/${nyDate()}`, { adjusted: 'true', sort: 'asc', limit: 50000 }, 15 * 60);
  return data.results || [];
}

export async function prevClose(symbol) {
  const data = await get(`/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev`, { adjusted: 'true' }, 5 * 60);
  return data.results?.[0] || null;
}

export async function tickerDetails(symbol) {
  const data = await get(`/v3/reference/tickers/${encodeURIComponent(symbol)}`, {}, 24 * 3600);
  const r = data.results || {};
  return { name: r.name ?? null, marketCap: r.market_cap ?? null, sector: r.sic_description ?? null, exchange: r.primary_exchange ?? null };
}

export async function fundamentals(symbol) {
  const data = await get('/vX/reference/financials', { ticker: symbol, timeframe: 'ttm', limit: 1, order: 'desc', sort: 'filing_date' }, 24 * 3600);
  const inc = data.results?.[0]?.financials?.income_statement;
  if (!inc) return null;
  return { netIncome: inc.net_income_loss?.value ?? null, revenue: inc.revenues?.value ?? null, period: data.results[0].fiscal_period ?? null };
}

export async function nextDividend(symbol) {
  const data = await get('/v3/reference/dividends', { ticker: symbol, 'ex_dividend_date.gte': nyDate(), order: 'asc', sort: 'ex_dividend_date', limit: 3 }, 12 * 3600);
  const r = data.results?.[0];
  return r ? { exDate: r.ex_dividend_date, amount: r.cash_amount ?? null } : false;
}

export async function nextEarnings(symbol) {
  const data = await get('/benzinga/v1/earnings', { ticker: symbol, 'date.gte': nyDate(), 'date.lte': nyDate(90), sort: 'date.asc', limit: 5 }, 12 * 3600);
  const r = (data.results || []).filter((x) => x.date).sort((a, b) => (a.date < b.date ? -1 : 1))[0];
  return r ? r.date : false;
}

export async function optionChain(symbol, { type, expFrom, expTo, strikeFrom, strikeTo }) {
  return getAll(
    `/v3/snapshot/options/${encodeURIComponent(symbol)}`,
    {
      contract_type: type,
      'expiration_date.gte': expFrom,
      'expiration_date.lte': expTo,
      'strike_price.gte': strikeFrom,
      'strike_price.lte': strikeTo,
      limit: 250,
    },
    90,
  );
}
