import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normCdf, probAbove, sma, stockMetrics, normalizeContract, evaluateContract, buildStrategy, verdictFor, dayDiff, trendScore, qualityScore } from '../api/_lib/engine.js';

test('normCdf matches known values', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(normCdf(-1) - 0.1587) < 1e-3);
});

test('probAbove is null without IV and sensible with it', () => {
  assert.equal(probAbove(100, 90, 30 / 365, null), null);
  const p = probAbove(100, 90, 30 / 365, 0.25, 0.04);
  assert.ok(p > 0.85 && p < 0.95, String(p));
  assert.ok(probAbove(100, 110, 30 / 365, 0.25) < 0.15);
});

test('sma and dayDiff', () => {
  assert.equal(sma([1, 2, 3, 4], 2), 3.5);
  assert.equal(sma([1, 2], 3), null);
  assert.equal(dayDiff('2026-10-22', '2026-11-21'), 30);
});

test('stockMetrics computes trend inputs, null when insufficient', () => {
  assert.equal(stockMetrics([]), null);
  const bars = Array.from({ length: 260 }, (_, i) => ({ c: 100 + i * 0.2, h: 101 + i * 0.2, l: 99 + i * 0.2, v: 1000 }));
  const m = stockMetrics(bars);
  assert.ok(m.sma200 < m.sma50 && m.sma50 < m.close);
  assert.ok(m.sma50Slope > 0);
  assert.equal(trendScore(m).score, 100);
  // Missing fundamentals are excluded, not zeroed
  const q = qualityScore(m, { marketCap: 3e11 }, null);
  assert.equal(q.items.find((i) => i.label.startsWith('Profitable')).earned, null);
  assert.ok(q.score > 80);
});

const raw = (over = {}) => ({
  details: { contract_type: 'put', expiration_date: '2026-11-21', strike_price: 95, shares_per_contract: 100 },
  greeks: { delta: -0.22 },
  implied_volatility: 0.3,
  open_interest: 2500,
  day: { volume: 400 },
  last_quote: { bid: 1.4, ask: 1.5 },
  underlying_asset: { price: 100 },
  ...over,
});

test('normalizeContract keeps missing quotes as null', () => {
  const c = normalizeContract(raw({ last_quote: undefined }), '2026-10-22');
  assert.equal(c.mid, null);
  assert.equal(c.bid, null);
  const q = normalizeContract(raw(), '2026-10-22');
  assert.equal(q.mid, 1.45);
  assert.equal(q.dte, 30);
});

const ctx = { strategy: 'csp', price: 100, todayISO: '2026-10-22', hv20: 0.25, earningsDate: false, exDivDate: false, targetMonthly: 0.015, rate: 0.04, capital: 50000, risk: 'balanced', minOI: 100, maxSpread: 0.12, dteMin: 15, dteMax: 45, basis: null };

test('evaluateContract math for a cash-secured put', () => {
  const e = evaluateContract(normalizeContract(raw(), ctx.todayISO), ctx);
  assert.equal(e.collateral, 9500);
  assert.equal(e.premiumTotal, 145);
  assert.equal(e.breakeven, 93.55);
  assert.ok(Math.abs(e.monthly - 1.45 / 95) < 1e-4);
  assert.ok(e.pOTM > 0.7 && e.pOTM < 0.9);
  assert.ok(e.pProfit > e.pOTM);
});

test('buildStrategy marks Unverified when quotes or greeks are missing', () => {
  const noQuotes = [normalizeContract(raw({ last_quote: undefined }), ctx.todayISO)];
  assert.equal(buildStrategy(noQuotes, ctx, {}).status, 'unverified');
  const noGreeks = [normalizeContract(raw({ greeks: undefined, implied_volatility: undefined }), ctx.todayISO)];
  assert.equal(buildStrategy(noGreeks, ctx, {}).status, 'unverified');
});

test('buildStrategy picks tiers, scores and caps verdict on earnings', () => {
  const contracts = [
    raw({ details: { contract_type: 'put', expiration_date: '2026-11-21', strike_price: 90 }, greeks: { delta: -0.12 }, last_quote: { bid: 0.6, ask: 0.66 } }),
    raw(),
    raw({ details: { contract_type: 'put', expiration_date: '2026-11-21', strike_price: 97.5 }, greeks: { delta: -0.35 }, last_quote: { bid: 2.3, ask: 2.4 } }),
  ].map((r) => normalizeContract(r, ctx.todayISO));
  const bars = Array.from({ length: 260 }, (_, i) => ({ c: 70 + i * 0.12, h: 71 + i * 0.12, l: 69 + i * 0.12, v: 1000 }));
  const metrics = stockMetrics(bars);
  const stock = { metrics, trend: trendScore(metrics, 100), quality: qualityScore(metrics, { marketCap: 3e11 }, { netIncome: 1e9 }), regime: { label: 'Risk-on', adj: 3 } };
  const s = buildStrategy(contracts, ctx, stock);
  assert.equal(s.status, 'ok');
  assert.equal(s.tiers.conservative.strike, 90);
  assert.equal(s.tiers.balanced.strike, 95);
  assert.equal(s.tiers.aggressive.strike, 97.5);
  assert.equal(s.selected, 'balanced');
  assert.ok(s.score >= 0 && s.score <= 100);
  assert.equal(s.verdict, verdictFor(s.score));

  const withEarnings = buildStrategy(contracts, { ...ctx, earningsDate: '2026-11-01' }, { ...stock, earningsDate: '2026-11-01' });
  assert.ok(['Watch', 'Avoid'].includes(withEarnings.verdict));
  assert.ok(withEarnings.warnings.some((w) => w.includes('Earnings')));
});

test('capital gate excludes unaffordable strikes', () => {
  const contracts = [normalizeContract(raw(), ctx.todayISO)];
  const s = buildStrategy(contracts, { ...ctx, capital: 5000 }, { trend: {}, quality: {} });
  assert.equal(s.status, 'no-contracts');
  assert.match(s.reasons[0], /capital/);
});
