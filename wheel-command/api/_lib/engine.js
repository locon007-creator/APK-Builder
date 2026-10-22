// Pure analytics: indicators, option math, contract evaluation and scoring.
// Nothing in this module fetches data or fabricates values: every metric is
// derived from inputs, and a missing input produces `null`, never a default.

export const TIERS = {
  conservative: { key: 'conservative', label: 'Conservative', delta: [0.08, 0.2] },
  balanced: { key: 'balanced', label: 'Balanced', delta: [0.18, 0.3] },
  aggressive: { key: 'aggressive', label: 'Aggressive', delta: [0.28, 0.42] },
};

export const WEIGHTS = { trend: 0.2, quality: 0.15, liquidity: 0.2, income: 0.2, risk: 0.25 };

export const VERDICTS = [
  { min: 75, label: 'Strong Candidate' },
  { min: 62, label: 'Favorable' },
  { min: 48, label: 'Watch' },
  { min: -Infinity, label: 'Avoid' },
];

const clamp = (x, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
const round = (x, d = 2) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
export const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// ---------- statistics ----------

export function normCdf(x) {
  // Abramowitz & Stegun 7.1.26 erf approximation (|error| < 1.5e-7).
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return 0.5 * (1 + (x >= 0 ? erf : -erf));
}

// Risk-neutral probability that the underlying finishes above `k` at expiry
// (Black-Scholes N(d2)), using the contract's own implied volatility.
export function probAbove(s, k, years, iv, rate = 0) {
  if (!(s > 0 && k > 0 && years > 0 && iv > 0)) return null;
  const d2 = (Math.log(s / k) + (rate - 0.5 * iv * iv) * years) / (iv * Math.sqrt(years));
  return normCdf(d2);
}

export function sma(values, n, endOffset = 0) {
  const end = values.length - endOffset;
  if (end < n || n <= 0) return null;
  let sum = 0;
  for (let i = end - n; i < end; i++) sum += values[i];
  return sum / n;
}

export function realizedVol(closes, n) {
  if (closes.length < n + 1) return null;
  const rets = [];
  for (let i = closes.length - n; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

// bars: [{ t, o, h, l, c, v }] ascending by time.
export function stockMetrics(bars) {
  const valid = (bars || []).filter((b) => num(b.c) > 0);
  if (valid.length < 2) return null;
  const closes = valid.map((b) => b.c);
  const last = valid[valid.length - 1];
  const year = valid.slice(-252);
  const high52 = Math.max(...year.map((b) => num(b.h) ?? b.c));
  const low52 = Math.min(...year.map((b) => num(b.l) ?? b.c));
  let peak = -Infinity;
  let maxDD = 0;
  for (const b of year) {
    peak = Math.max(peak, b.c);
    maxDD = Math.max(maxDD, (peak - b.c) / peak);
  }
  const pct = (n) => (closes.length > n ? closes[closes.length - 1] / closes[closes.length - 1 - n] - 1 : null);
  const sma50 = sma(closes, 50);
  const sma50Prev = sma(closes, 50, 20);
  const avgVol = valid.slice(-20).reduce((a, b) => a + (num(b.v) ?? 0), 0) / Math.min(20, valid.length);
  return {
    close: last.c,
    closeTime: last.t ?? null,
    prevClose: closes[closes.length - 2],
    sma20: sma(closes, 20),
    sma50,
    sma200: sma(closes, 200),
    sma50Slope: sma50 != null && sma50Prev != null ? sma50 / sma50Prev - 1 : null,
    hv20: realizedVol(closes, 20),
    hv252: realizedVol(closes, Math.min(251, closes.length - 1)),
    high52,
    low52,
    fromHigh: last.c / high52 - 1,
    maxDrawdown1y: maxDD,
    change1d: pct(1),
    change1m: pct(21),
    change3m: pct(63),
    avgVolume20: avgVol,
    bars: valid.length,
    spark: closes.slice(-90).map((c) => round(c, 2)),
  };
}

// ---------- stock-level components (0-100, with transparent point lists) ----------

function scored(items) {
  const available = items.filter((i) => i.earned != null);
  const possible = available.reduce((a, i) => a + i.max, 0);
  const earned = available.reduce((a, i) => a + i.earned, 0);
  return {
    score: possible > 0 ? Math.round((earned / possible) * 100) : null,
    items: items.map((i) => ({ ...i, earned: i.earned == null ? null : round(i.earned, 1) })),
  };
}

export function trendScore(m, price) {
  if (!m) return { score: null, items: [] };
  const p = price ?? m.close;
  const has = (v) => v != null;
  return scored([
    { label: 'Above 200-day SMA', max: 30, earned: has(m.sma200) ? (p > m.sma200 ? 30 : 0) : null },
    { label: 'Above 50-day SMA', max: 25, earned: has(m.sma50) ? (p > m.sma50 ? 25 : 0) : null },
    { label: '50-day above 200-day', max: 20, earned: has(m.sma50) && has(m.sma200) ? (m.sma50 > m.sma200 ? 20 : 0) : null },
    { label: '50-day SMA rising', max: 15, earned: has(m.sma50Slope) ? 15 * clamp(0.5 + m.sma50Slope * 25) : null },
    { label: 'Within 15% of 52-week high', max: 10, earned: has(m.fromHigh) ? 10 * clamp(1 + m.fromHigh / 0.3) : null },
  ]);
}

export function qualityScore(m, details, fundamentals) {
  const cap = num(details?.marketCap);
  const capPts = cap == null ? null : cap >= 2e11 ? 35 : cap >= 5e10 ? 28 : cap >= 1e10 ? 18 : 8;
  const hv = m?.hv252;
  const hvPts = hv == null ? null : hv <= 0.22 ? 25 : hv <= 0.32 ? 19 : hv <= 0.45 ? 11 : 4;
  const dd = m?.maxDrawdown1y;
  const ddPts = dd == null ? null : dd <= 0.15 ? 20 : dd <= 0.25 ? 14 : dd <= 0.4 ? 7 : 2;
  const ni = num(fundamentals?.netIncome);
  const niPts = ni == null ? null : ni > 0 ? 20 : 0;
  return scored([
    { label: 'Market capitalization', max: 35, earned: capPts },
    { label: 'Low 1-year volatility', max: 25, earned: hvPts },
    { label: 'Contained 1-year drawdown', max: 20, earned: ddPts },
    { label: 'Profitable (trailing 12 months)', max: 20, earned: niPts },
  ]);
}

export function marketRegime(spy) {
  if (!spy || spy.sma200 == null || spy.sma50 == null) return { label: 'Unknown', adj: 0, detail: 'S&P 500 proxy (SPY) history unavailable' };
  const above200 = spy.close > spy.sma200;
  const above50 = spy.close > spy.sma50;
  const vol = spy.hv20;
  if (above200 && above50 && (vol == null || vol < 0.22)) return { label: 'Risk-on', adj: 3, detail: 'SPY above 50 & 200-day SMA, volatility contained' };
  if (!above200) return { label: 'Risk-off', adj: -6, detail: 'SPY below its 200-day SMA' };
  return { label: 'Neutral', adj: 0, detail: above50 ? 'SPY uptrend with elevated volatility' : 'SPY below its 50-day SMA' };
}

// ---------- contracts ----------

export function dayDiff(fromISO, toISO) {
  const a = Date.UTC(...fromISO.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
  const b = Date.UTC(...toISO.split('-').map((x, i) => Number(x) - (i === 1 ? 1 : 0)));
  return Math.round((b - a) / 86400000);
}

// Normalizes one Massive /v3/snapshot/options result. Returns null when the
// record is structurally unusable (no strike/expiry/type).
export function normalizeContract(r, todayISO) {
  const d = r?.details || {};
  const strike = num(d.strike_price);
  const exp = typeof d.expiration_date === 'string' ? d.expiration_date : null;
  const type = d.contract_type === 'put' || d.contract_type === 'call' ? d.contract_type : null;
  if (strike == null || !exp || !type) return null;
  const q = r.last_quote || {};
  const bid = num(q.bid);
  const ask = num(q.ask);
  const quoted = bid != null && ask != null && ask > 0 && ask >= bid;
  const mid = quoted ? num(q.midpoint) ?? (bid + ask) / 2 : null;
  return {
    symbol: d.ticker ?? null,
    type,
    strike,
    expiration: exp,
    dte: dayDiff(todayISO, exp),
    shares: num(d.shares_per_contract) ?? 100,
    bid: quoted ? bid : null,
    ask: quoted ? ask : null,
    mid,
    spreadPct: quoted && mid > 0 ? (ask - bid) / mid : null,
    quoteTime: num(q.last_updated),
    delta: num(r.greeks?.delta),
    theta: num(r.greeks?.theta),
    iv: num(r.implied_volatility),
    oi: num(r.open_interest),
    volume: num(r.day?.volume) ?? 0,
    underlyingPrice: num(r.underlying_asset?.price),
  };
}

// ctx: { strategy:'csp'|'cc', price, hv20, earningsDate, exDivDate, targetMonthly, rate, basis }
export function evaluateContract(c, ctx) {
  const S = ctx.price;
  const years = c.dte / 365;
  const per = c.shares;
  const isPut = ctx.strategy === 'csp';
  const premium = c.mid;
  const collateral = isPut ? c.strike * per : (ctx.basis != null ? 0 : S * per);
  const breakeven = isPut ? c.strike - premium : (ctx.basis ?? S) - premium;
  const yieldBase = isPut ? c.strike : (ctx.basis ?? S);
  const roc = premium / yieldBase;
  const monthly = (roc * 30) / c.dte;
  const annualized = (roc * 365) / c.dte;
  const pAbove = probAbove(S, c.strike, years, c.iv, ctx.rate);
  const pOTM = pAbove == null ? null : isPut ? pAbove : 1 - pAbove;
  const pProfit = probAbove(S, breakeven, years, c.iv, ctx.rate);
  const expMove = c.iv != null ? S * c.iv * Math.sqrt(years) : null;
  const cushion = (S - breakeven) / S;
  const cushionEM = expMove ? (S - breakeven) / expMove : null;
  const earningsInWindow = ctx.earningsDate ? ctx.earningsDate >= ctx.todayISO && ctx.earningsDate <= c.expiration : ctx.earningsDate === null ? null : false;
  const exDivInWindow = ctx.exDivDate ? ctx.exDivDate >= ctx.todayISO && ctx.exDivDate <= c.expiration : ctx.exDivDate === null ? null : false;
  const ivhv = c.iv != null && ctx.hv20 ? c.iv / ctx.hv20 : null;

  // Liquidity (contract-level)
  const liq = scored([
    { label: 'Open interest', max: 40, earned: c.oi == null ? null : 40 * clamp(Math.log10(1 + c.oi) / Math.log10(5001)) },
    { label: 'Daily volume', max: 25, earned: 25 * clamp(Math.log10(1 + (c.volume || 0)) / Math.log10(1001)) },
    { label: 'Bid/ask spread', max: 35, earned: c.spreadPct == null ? null : c.spreadPct <= 0.03 ? 35 : c.spreadPct <= 0.06 ? 26 : c.spreadPct <= 0.1 ? 14 : c.spreadPct <= 0.15 ? 6 : 0 },
  ]);

  // Income vs the user's target (hitting target = 67, 1.5x target = 100)
  const target = ctx.targetMonthly > 0 ? ctx.targetMonthly : 0.015;
  const income = { score: Math.round(100 * clamp(monthly / (1.5 * target))), items: [{ label: `Monthly-equivalent return vs ${round(target * 100, 2)}% target`, max: 100, earned: round(100 * clamp(monthly / (1.5 * target)), 1) }] };

  const cushionRef = isPut ? 1 : 0.5;
  const risk = scored([
    { label: 'Probability OTM at expiry', max: 40, earned: pOTM == null ? null : 40 * clamp((pOTM - 0.5) / 0.45) },
    { label: isPut ? 'Break-even cushion vs expected move' : 'Premium cushion vs expected move', max: 30, earned: cushionEM == null ? null : 30 * clamp(cushionEM / cushionRef) },
    { label: 'Implied vs realized volatility', max: 15, earned: ivhv == null ? null : ivhv >= 1 && ivhv <= 1.6 ? 15 : ivhv > 1.6 ? 8 : ivhv >= 0.85 ? 10 : 5 },
    { label: 'No earnings before expiry', max: 15, earned: earningsInWindow == null ? 7 : earningsInWindow ? 0 : 15 },
    ...(isPut ? [] : [{ label: 'No ex-dividend before expiry', max: 10, earned: exDivInWindow == null ? 5 : exDivInWindow ? (Math.abs(c.delta ?? 0) > 0.4 ? 0 : 5) : 10 }]),
  ]);

  const dtePenalty = Math.min(8, Math.abs(c.dte - 30) / 3);
  const pick = 0.4 * income.score + 0.3 * (liq.score ?? 0) + 0.3 * (risk.score ?? 0) - dtePenalty;

  return {
    ...c,
    premium: round(premium, 2),
    premiumTotal: round(premium * per, 2),
    collateral: round(collateral, 2),
    breakeven: round(breakeven, 2),
    roc: round(roc, 5),
    monthly: round(monthly, 5),
    annualized: round(annualized, 5),
    pOTM: round(pOTM, 4),
    pProfit: round(pProfit, 4),
    pAssign: round(pOTM == null ? null : 1 - pOTM, 4),
    expectedMove: round(expMove, 2),
    cushion: round(cushion, 4),
    cushionEM: round(cushionEM, 3),
    ivhv: round(ivhv, 3),
    calledAwayGain: isPut ? null : round((c.strike - (ctx.basis ?? S) + premium) * per, 2),
    earningsInWindow,
    exDivInWindow,
    scores: { liquidity: liq, income, risk },
    pickScore: round(pick, 2),
  };
}

export function passesGates(c, ctx) {
  const reasons = [];
  if (c.mid == null || !(c.bid > 0)) reasons.push('no bid');
  if (c.delta == null) reasons.push('no delta');
  if (c.iv == null) reasons.push('no IV');
  if (c.oi == null || c.oi < ctx.minOI) reasons.push('open interest');
  if (c.spreadPct == null || c.spreadPct > ctx.maxSpread) reasons.push('spread');
  if (c.dte < ctx.dteMin || c.dte > ctx.dteMax) reasons.push('expiration');
  if (ctx.strategy === 'csp' && c.strike * c.shares > ctx.capital) reasons.push('capital');
  if (ctx.strategy === 'cc' && ctx.basis == null && ctx.price * c.shares > ctx.capital) reasons.push('capital');
  if (ctx.strategy === 'cc' && ctx.basis != null && c.strike < ctx.basis) reasons.push('below cost basis');
  if (ctx.strategy === 'csp' && c.strike >= ctx.price) reasons.push('in the money');
  if (ctx.strategy === 'cc' && c.strike <= ctx.price) reasons.push('in the money');
  return reasons;
}

export function verdictFor(score) {
  return VERDICTS.find((v) => score >= v.min).label;
}

const VERDICT_ORDER = VERDICTS.map((v) => v.label);
const capVerdict = (label, cap) => (VERDICT_ORDER.indexOf(label) < VERDICT_ORDER.indexOf(cap) ? cap : label);

// Builds one strategy's opportunity from raw contracts.
// Returns { status, tiers, selected, score, breakdown, verdict, reasons, warnings }.
export function buildStrategy(contracts, ctx, stock) {
  const sideType = ctx.strategy === 'csp' ? 'put' : 'call';
  const side = contracts.filter((c) => c.type === sideType);
  const quoted = side.filter((c) => c.mid != null);
  const greeked = quoted.filter((c) => c.delta != null && c.iv != null);
  if (side.length === 0) return { status: 'no-contracts', reasons: [`No listed ${sideType}s in the ${ctx.dteMin}–${ctx.dteMax} day window near the money`] };
  if (quoted.length === 0) return { status: 'unverified', reasons: ['Option bid/ask quotes not available from the data provider'] };
  if (greeked.length === 0) return { status: 'unverified', reasons: ['Delta/implied volatility not available from the data provider'] };

  const gateCounts = {};
  const eligible = [];
  for (const c of greeked) {
    const fails = passesGates(c, ctx);
    if (fails.length) fails.forEach((f) => (gateCounts[f] = (gateCounts[f] || 0) + 1));
    else eligible.push(c);
  }

  const tiers = {};
  for (const t of Object.values(TIERS)) {
    const band = eligible.filter((c) => Math.abs(c.delta) >= t.delta[0] && Math.abs(c.delta) <= t.delta[1]);
    const evaluated = band.map((c) => evaluateContract(c, ctx)).sort((a, b) => b.pickScore - a.pickScore);
    tiers[t.key] = evaluated[0] || null;
  }

  const order = [ctx.risk, 'balanced', 'conservative', 'aggressive'];
  const selectedKey = order.find((k) => tiers[k]);
  if (!selectedKey) {
    const top = Object.entries(gateCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k);
    return {
      status: 'no-contracts',
      tiers,
      reasons: [`No contract passed filters in any delta band${top.length ? ` (most common blockers: ${top.join(', ')})` : ''}`],
    };
  }
  const sel = tiers[selectedKey];

  const breakdown = {
    trend: stock.trend.score,
    quality: stock.quality.score,
    liquidity: sel.scores.liquidity.score,
    income: sel.scores.income.score,
    risk: sel.scores.risk.score,
  };
  let wsum = 0;
  let total = 0;
  for (const [k, w] of Object.entries(WEIGHTS)) {
    if (breakdown[k] != null) {
      total += w * breakdown[k];
      wsum += w;
    }
  }
  const base = wsum > 0 ? total / wsum : 0;
  const score = Math.round(clamp(base + (stock.regime?.adj || 0), 0, 100));
  let verdict = verdictFor(score);

  const reasons = [];
  const warnings = [];
  const pct = (x, d = 1) => `${round(x * 100, d)}%`;
  const m = stock.metrics;

  if (m?.sma200 != null) (ctx.price > m.sma200 ? reasons : warnings).push(ctx.price > m.sma200 ? 'Trading above its 200-day average' : 'Trading below its 200-day average');
  if (m?.sma50 != null && m?.sma200 != null && m.sma50 > m.sma200 && ctx.price > m.sma50) reasons.push('Uptrend: price > 50-day > 200-day');
  if (sel.monthly >= ctx.targetMonthly) reasons.push(`${pct(sel.monthly, 2)} monthly-equivalent return meets your ${pct(ctx.targetMonthly, 2)} target`);
  else warnings.push(`${pct(sel.monthly, 2)} monthly-equivalent return is below your ${pct(ctx.targetMonthly, 2)} target`);
  if (sel.pOTM != null) (sel.pOTM >= 0.7 ? reasons : warnings).push(`${pct(sel.pOTM, 0)} implied probability of expiring out of the money`);
  if (sel.cushionEM != null && ctx.strategy === 'csp') (sel.cushionEM >= 1 ? reasons : warnings).push(sel.cushionEM >= 1 ? 'Break-even sits beyond the 1σ expected move' : 'Break-even sits inside the 1σ expected move');
  if (sel.spreadPct != null) (sel.spreadPct <= 0.06 ? reasons : warnings).push(`${pct(sel.spreadPct, 1)} bid/ask spread`);
  if (sel.oi != null && sel.oi >= 1000) reasons.push(`Deep open interest (${sel.oi.toLocaleString('en-US')})`);
  if (sel.ivhv != null && sel.ivhv >= 1.1 && sel.ivhv <= 1.6) reasons.push(`Implied volatility ${round(sel.ivhv, 2)}× realized — premium is rich`);
  if (sel.ivhv != null && sel.ivhv > 1.6) warnings.push(`Implied volatility ${round(sel.ivhv, 2)}× realized — market may be pricing an event`);
  if (sel.earningsInWindow === true) {
    warnings.push(`Earnings on ${stock.earningsDate} fall before expiration`);
    verdict = capVerdict(verdict, 'Watch');
  } else if (sel.earningsInWindow == null) warnings.push('Earnings date unavailable — verify before trading');
  if (ctx.strategy === 'cc' && sel.exDivInWindow) warnings.push(`Ex-dividend ${stock.exDivDate} before expiration — early assignment possible if ITM`);
  if (ctx.strategy === 'csp' && m?.sma200 != null && m?.sma50 != null && ctx.price < m.sma200 && ctx.price < m.sma50) {
    warnings.push('Downtrend — assignment would add a falling stock');
    verdict = capVerdict(verdict, 'Watch');
  }
  if (stock.regime?.label === 'Risk-off') warnings.push('Broad market is risk-off (SPY below 200-day SMA)');

  return { status: 'ok', tiers, selected: selectedKey, score, breakdown, weights: WEIGHTS, regimeAdj: stock.regime?.adj || 0, verdict, reasons, warnings, eligibleCount: eligible.length, examinedCount: greeked.length };
}
