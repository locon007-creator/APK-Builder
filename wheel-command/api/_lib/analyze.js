// Fetches everything needed for one underlying and runs the scoring engine.

import * as M from './massive.js';
import { stockMetrics, trendScore, qualityScore, marketRegime, normalizeContract, buildStrategy } from './engine.js';

const settle = (p) => p.then((value) => ({ ok: true, value }), (error) => ({ ok: false, error }));

let regimeMemo = { at: 0, value: null };
export async function getRegime() {
  if (regimeMemo.value && Date.now() - regimeMemo.at < 15 * 60 * 1000) return regimeMemo.value;
  const bars = await M.dailyBars('SPY');
  const spy = stockMetrics(bars);
  const value = { ...marketRegime(spy), spy: spy && { close: spy.close, sma50: spy.sma50, sma200: spy.sma200, hv20: spy.hv20, change1d: spy.change1d, change1m: spy.change1m, spark: spy.spark } };
  regimeMemo = { at: Date.now(), value };
  return value;
}

export async function analyzeSymbol(symbol, opts) {
  const today = M.nyDate();
  const sources = {};
  const [barsR, detailsR, fundR, divR, earnR, regimeR] = await Promise.all([
    settle(M.dailyBars(symbol)),
    settle(M.tickerDetails(symbol)),
    settle(M.fundamentals(symbol)),
    settle(M.nextDividend(symbol)),
    settle(M.nextEarnings(symbol)),
    settle(getRegime()),
  ]);
  if (!barsR.ok) {
    const e = barsR.error;
    return { symbol, status: e.status === 503 ? 'error' : 'unverified', error: e.message, reasons: ['Price history unavailable'] };
  }
  const metrics = stockMetrics(barsR.value);
  if (!metrics) return { symbol, status: 'unverified', reasons: ['Insufficient price history'] };

  const details = detailsR.ok ? detailsR.value : null;
  const fund = fundR.ok ? fundR.value : null;
  const dividend = divR.ok ? divR.value : null; // object | false (none scheduled) | null (unknown)
  const earningsDate = earnR.ok ? earnR.value : null; // 'YYYY-MM-DD' | false | null
  const regime = regimeR.ok ? regimeR.value : { label: 'Unknown', adj: 0, detail: 'Market data unavailable' };
  sources.details = detailsR.ok;
  sources.fundamentals = fundR.ok && fund != null;
  sources.dividends = divR.ok;
  sources.earnings = earnR.ok;

  const strategies = opts.strategy === 'both' ? ['csp', 'cc'] : [opts.strategy];
  const base = metrics.close;
  const expFrom = M.nyDate(opts.dteMin);
  const expTo = M.nyDate(opts.dteMax);

  const chains = await Promise.all(
    strategies.map((s) =>
      settle(
        M.optionChain(symbol, {
          type: s === 'csp' ? 'put' : 'call',
          expFrom,
          expTo,
          strikeFrom: (s === 'csp' ? base * 0.7 : Math.max(base * 0.97, opts.basis || 0)).toFixed(2),
          strikeTo: (s === 'csp' ? base * 1.03 : Math.max(base * 1.35, (opts.basis || 0) * 1.15)).toFixed(2),
        }),
      ),
    ),
  );

  const stock = {
    metrics,
    trend: null,
    quality: qualityScore(metrics, details, fund),
    regime,
    earningsDate,
    exDivDate: dividend ? dividend.exDate : dividend,
  };

  const out = {};
  let livePrice = null;
  strategies.forEach((s, i) => {
    const r = chains[i];
    if (!r.ok) {
      out[s] = { status: r.error.status === 503 ? 'error' : 'unverified', reasons: [`Options chain unavailable: ${r.error.message}`] };
      return;
    }
    const contracts = r.value.results.map((x) => normalizeContract(x, today)).filter(Boolean);
    const up = contracts.find((c) => c.underlyingPrice)?.underlyingPrice;
    if (up) livePrice = up;
    out[s] = { contracts };
  });

  const price = livePrice ?? metrics.close;
  stock.trend = trendScore(metrics, price);

  for (const s of strategies) {
    if (!out[s].contracts) continue;
    const ctx = {
      strategy: s,
      price,
      todayISO: today,
      hv20: metrics.hv20,
      earningsDate,
      exDivDate: stock.exDivDate,
      targetMonthly: opts.target,
      rate: opts.rate,
      capital: opts.capital,
      risk: opts.risk,
      minOI: opts.minOI,
      maxSpread: opts.maxSpread,
      dteMin: opts.dteMin,
      dteMax: opts.dteMax,
      basis: s === 'cc' ? opts.basis : null,
    };
    out[s] = buildStrategy(out[s].contracts, ctx, stock);
  }

  // Headline = best scoring verified strategy.
  const ranked = strategies.filter((s) => out[s].status === 'ok').sort((a, b) => out[b].score - out[a].score);
  const primary = ranked[0] || null;
  const status = primary ? 'ok' : strategies.some((s) => out[s].status === 'no-contracts') ? 'no-contracts' : strategies.some((s) => out[s].status === 'unverified') ? 'unverified' : 'error';

  return {
    symbol,
    name: details?.name ?? null,
    sector: details?.sector ?? null,
    marketCap: details?.marketCap ?? null,
    price,
    priceSource: livePrice ? 'options snapshot' : 'last daily close',
    asOf: today,
    status,
    primary,
    score: primary ? out[primary].score : null,
    verdict: primary ? out[primary].verdict : status === 'no-contracts' ? 'Avoid' : 'Unverified',
    strategies: out,
    stock: {
      metrics,
      trend: stock.trend,
      quality: stock.quality,
      fundamentals: fund,
      earningsDate,
      dividend,
      regime: { label: regime.label, adj: regime.adj, detail: regime.detail },
    },
    sources,
  };
}
