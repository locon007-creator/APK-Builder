import { describe, expect, it } from 'vitest';
import { classifyFreshness, FRESHNESS } from '../server/domain/freshness.ts';
import { computeRanking, recencyScore } from '../server/domain/ranking.ts';
import { resolveAsOf, quarterEndOnOrBefore, previousQuarterEnd } from '../server/domain/asof.ts';

const NOW = '2026-03-01T12:00:00.000Z';

describe('freshness classification', () => {
  it('demo records are always labelled demo', () => {
    expect(classifyFreshness({ kind: 'filing', origin: 'demo', acceptedAt: NOW, now: NOW }).status).toBe('demo');
    expect(classifyFreshness({ kind: 'market', origin: 'demo', observedAt: NOW, delayMinutes: null, now: NOW })).toMatchObject({ status: 'demo', isDemo: true });
  });
  it('missing inputs are unavailable', () => {
    expect(classifyFreshness({ kind: 'filing', origin: 'sec', acceptedAt: null, now: NOW }).status).toBe('unavailable');
    expect(classifyFreshness({ kind: 'market', origin: 'sec', observedAt: null, delayMinutes: null, now: NOW }).status).toBe('unavailable');
  });
  it('uses acceptance time, not ingestion, for recently filed vs stale', () => {
    expect(classifyFreshness({ kind: 'filing', origin: 'sec', acceptedAt: '2026-02-27T00:00:00.000Z', now: NOW }).status).toBe('recently_filed');
    expect(classifyFreshness({ kind: 'filing', origin: 'sec', acceptedAt: '2026-02-10T00:00:00.000Z', now: NOW }).status).toBe('historical');
    expect(classifyFreshness({ kind: 'filing', origin: 'sec', acceptedAt: '2026-01-01T00:00:00.000Z', now: NOW }).status).toBe('stale');
  });
  it('a recently filed 13F is flagged as not implying recent trading', () => {
    const f = classifyFreshness({ kind: 'holdings', origin: 'sec', acceptedAt: '2026-02-27T00:00:00.000Z', periodOfReport: '2025-12-31', now: NOW });
    expect(f.status).toBe('recently_filed');
    expect(f.reason).toMatch(/does not mean recent trading/);
    expect(f.reason).toMatch(/2025-12-31/);
  });
  it('old 13F periods become stale and others are historical', () => {
    expect(classifyFreshness({ kind: 'holdings', origin: 'sec', acceptedAt: '2025-05-15T00:00:00.000Z', periodOfReport: '2025-03-31', now: NOW }).status).toBe('stale');
    expect(classifyFreshness({ kind: 'holdings', origin: 'sec', acceptedAt: '2025-11-14T00:00:00.000Z', periodOfReport: '2025-09-30', now: NOW }).status).toBe('historical');
  });
  it('market data goes stale after the threshold', () => {
    expect(classifyFreshness({ kind: 'market', origin: 'sec', observedAt: '2026-02-28T21:00:00.000Z', delayMinutes: 15, now: NOW }).status).toBe('market');
    expect(classifyFreshness({ kind: 'market', origin: 'sec', observedAt: '2026-02-20T21:00:00.000Z', delayMinutes: 15, now: NOW }).status).toBe('stale');
    expect(FRESHNESS.marketStaleDays).toBe(4);
  });
});

describe('transparent ranking', () => {
  const inputs = [
    { key: 'a', label: 'A', weight: 30, normalized: 1, raw: '', formula: '' },
    { key: 'b', label: 'B', weight: 20, normalized: 0.5, raw: '', formula: '' },
    { key: 'm', label: 'Market', weight: 10, normalized: null, raw: '', formula: '' },
  ];
  it('excludes missing inputs from both sums and reports them', () => {
    const r = computeRanking(inputs, NOW, NOW);
    expect(r.score).toBe(80); // (30 + 10) / 50
    expect(r.coverage).toBeCloseTo(50 / 60, 2);
    expect(r.missing).toEqual(['Market']);
    expect(r.method).toMatch(/not a forecast/);
  });
  it('is reproducible for the same inputs regardless of computation time', () => {
    const a = computeRanking(inputs, NOW, '2026-03-01T00:00:00Z');
    const b = computeRanking(inputs, NOW, '2027-01-01T00:00:00Z');
    expect(a.score).toBe(b.score);
  });
  it('returns zero (not NaN) when nothing is available', () => {
    expect(computeRanking([{ ...inputs[2] }], NOW, NOW).score).toBe(0);
  });
  it('decays recency by half-life', () => {
    expect(recencyScore(0, 30)).toBe(1);
    expect(recencyScore(30, 30)).toBeCloseTo(0.5);
    expect(recencyScore(-5, 30)).toBe(1);
  });
});

describe('historical cutoff parsing', () => {
  const now = new Date(NOW);
  it('defaults to now and caps future dates at now', () => {
    expect(resolveAsOf(undefined, now)).toBe(NOW);
    expect(resolveAsOf('2030-01-01', now)).toBe(NOW);
  });
  it('treats a date-only cutoff as the end of that UTC day', () => {
    expect(resolveAsOf('2026-01-15', now)).toBe('2026-01-15T23:59:59.999Z');
  });
  it('rejects invalid cutoffs', () => {
    expect(() => resolveAsOf('not-a-date', now)).toThrow(RangeError);
  });
  it('computes quarter ends', () => {
    expect(quarterEndOnOrBefore('2025-08-14')).toBe('2025-06-30');
    expect(quarterEndOnOrBefore('2025-01-10')).toBe('2024-12-31');
    expect(previousQuarterEnd('2025-03-31')).toBe('2024-12-31');
  });
});
