import type { PriceBar } from '../../shared/types.ts';

export interface MarketContext {
  lastClose: number;
  lastDate: string;
  sma20: number | null;
  sma50: number | null;
  trend: 'above_50d' | 'below_50d' | 'insufficient_history';
  return5d: number | null;
  return20d: number | null;
  volumeZ: number | null;      // latest log-volume vs prior 50 sessions
  returnZ: number | null;      // latest daily return vs prior 60 sessions' volatility
  avgVolume50: number | null;
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const std = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
};

export function marketContext(bars: PriceBar[]): MarketContext | null {
  if (!bars.length) return null;
  const closes = bars.map((b) => b.close);
  const n = closes.length;
  const last = bars[n - 1];
  const sma = (k: number) => (n >= k ? mean(closes.slice(n - k)) : null);
  const ret = (k: number) => (n > k ? closes[n - 1] / closes[n - 1 - k] - 1 : null);
  let volumeZ: number | null = null;
  if (n >= 21) {
    const prior = bars.slice(Math.max(0, n - 51), n - 1).map((b) => Math.log(Math.max(1, b.volume)));
    const s = std(prior);
    volumeZ = s > 0 ? (Math.log(Math.max(1, last.volume)) - mean(prior)) / s : null;
  }
  let returnZ: number | null = null;
  if (n >= 22) {
    const rets: number[] = [];
    for (let i = Math.max(1, n - 61); i < n - 1; i++) rets.push(closes[i] / closes[i - 1] - 1);
    const s = std(rets);
    returnZ = s > 0 ? (closes[n - 1] / closes[n - 2] - 1) / s : null;
  }
  const sma50 = sma(50);
  return {
    lastClose: last.close,
    lastDate: last.date,
    sma20: sma(20),
    sma50,
    trend: sma50 == null ? 'insufficient_history' : last.close >= sma50 ? 'above_50d' : 'below_50d',
    return5d: ret(5),
    return20d: ret(20),
    volumeZ,
    returnZ,
    avgVolume50: n >= 50 ? mean(bars.slice(n - 50).map((b) => b.volume)) : null,
  };
}

/** Close-to-close move from the session before an event to `sessionsAfter` sessions later (only bars ≤ cutoff are supplied). */
export function eventWindowMove(bars: PriceBar[], eventDate: string, sessionsAfter = 5): { before: number; after: number; move: number; sessions: number } | null {
  const idx = bars.findIndex((b) => b.date >= eventDate);
  if (idx <= 0) return null;
  const before = bars[idx - 1].close;
  const endIdx = Math.min(bars.length - 1, idx + sessionsAfter - 1);
  const after = bars[endIdx].close;
  return { before, after, move: after / before - 1, sessions: endIdx - idx + 1 };
}
