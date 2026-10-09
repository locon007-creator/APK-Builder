import { describe, expect, it } from 'vitest';
import { classifyChange, computeManagerChanges, decomposeValueChange, portfolioWeight, resolve13F, selectFilingsFor13F, comparablePeriod, concentration } from '../server/domain/thirteenF.ts';
import { freshDb, file13F, M1, M2, CUSIP } from './helpers.ts';

const OTHER = '000000999';

describe('share-count change classification', () => {
  it('classifies by shares, not value', () => {
    expect(classifyChange(0, 100)).toBe('new');
    expect(classifyChange(100, 0)).toBe('exited');
    expect(classifyChange(100, 150)).toBe('increased');
    expect(classifyChange(100, 50)).toBe('reduced');
    expect(classifyChange(100, 100)).toBe('unchanged');
  });
});

describe('value decomposition (price vs share effects)', () => {
  it('attributes a pure price move to price, not to buying', () => {
    const d = decomposeValueChange(1000, 100_000, 1000, 150_000);
    expect(d.fromShares).toBe(0);
    expect(d.fromPrice).toBe(50_000);
  });
  it('always sums to the total change', () => {
    const cases = [[1000, 100_000, 1500, 120_000], [2000, 50_000, 500, 30_000], [10, 10, 20, 5]];
    for (const [sp, vp, sc, vc] of cases) {
      const d = decomposeValueChange(sp, vp, sc, vc);
      expect(d.fromShares + d.fromPrice).toBeCloseTo(vc - vp, 6);
    }
  });
  it('a value fall with more shares is still an increase in shares', () => {
    const d = decomposeValueChange(1000, 100_000, 1200, 90_000);
    expect(d.fromShares).toBeGreaterThan(0);
    expect(d.fromPrice).toBeLessThan(0);
  });
});

describe('portfolio weights', () => {
  it('computes weights against total equity value and handles empty portfolios', () => {
    expect(portfolioWeight(25, 100)).toBe(0.25);
    expect(portfolioWeight(25, 0)).toBeNull();
  });
  it('excludes option rows from weights and share counts', () => {
    const db = freshDb();
    file13F(db, { manager: M1, period: '2025-12-31', acceptedAt: '2026-02-10T21:00:00.000Z', rows: [
      { cusip: CUSIP, shares: 100, value: 750 }, { cusip: OTHER, shares: 10, value: 250, name: 'OTHER' }, { cusip: CUSIP, shares: 1000, value: 9999, putCall: 'Call' },
    ] });
    const r = resolve13F(db, M1, '2025-12-31', '2026-03-01T00:00:00.000Z')!;
    expect(r.totalEquityValue).toBe(1000);
    expect(r.positions.get(CUSIP)!.shares).toBe(100);
    expect(r.optionRows).toHaveLength(1);
    expect(concentration(r).largestWeight).toBe(0.75);
  });
});

describe('amendment handling', () => {
  const f = (accession: string, accepted: string, isAmend = false, type: string | null = null) => ({ accession, form_type: '13F-HR', is_amendment: isAmend ? 1 : 0, amendment_type: type, accepted_at: accepted, origin: 'sec' as const });
  it('RESTATEMENT replaces the original; NEW HOLDINGS adds to the base', () => {
    const s = selectFilingsFor13F([f('a', '2026-02-01'), f('b', '2026-02-10', true, 'NEW HOLDINGS'), f('c', '2026-02-20', true, 'RESTATEMENT'), f('d', '2026-02-25', true, 'NEW HOLDINGS')]);
    expect(s.base?.accession).toBe('c');
    expect(s.additions.map((x) => x.accession)).toEqual(['d']);
  });
  it('without a restatement, the original plus later additions are used', () => {
    const s = selectFilingsFor13F([f('b', '2026-02-10', true, 'NEW HOLDINGS'), f('a', '2026-02-01')]);
    expect(s.base?.accession).toBe('a');
    expect(s.additions.map((x) => x.accession)).toEqual(['b']);
  });
});

describe('look-ahead protection for 13F views', () => {
  const db = freshDb();
  file13F(db, { manager: M1, period: '2025-09-30', acceptedAt: '2025-11-10T21:00:00.000Z', rows: [{ cusip: CUSIP, shares: 100, value: 1000 }] });
  file13F(db, { manager: M1, period: '2025-12-31', acceptedAt: '2026-02-10T21:00:00.000Z', rows: [{ cusip: CUSIP, shares: 1000, value: 12000 }] }); // keying error
  file13F(db, { manager: M1, period: '2025-12-31', acceptedAt: '2026-02-20T21:00:00.000Z', amendmentType: 'RESTATEMENT', rows: [{ cusip: CUSIP, shares: 150, value: 1800 }] });
  file13F(db, { manager: M1, period: '2025-12-31', acceptedAt: '2026-02-25T21:00:00.000Z', amendmentType: 'NEW HOLDINGS', rows: [{ cusip: OTHER, shares: 5, value: 50, name: 'OTHER' }] });

  it('before the period is filed, the period does not exist', () => {
    expect(resolve13F(db, M1, '2025-12-31', '2026-02-01T00:00:00.000Z')).toBeNull();
  });
  it('between original and restatement, the original (unamended) figures are shown', () => {
    const r = resolve13F(db, M1, '2025-12-31', '2026-02-15T00:00:00.000Z')!;
    expect(r.positions.get(CUSIP)!.shares).toBe(1000);
    expect(r.amendmentsApplied).toHaveLength(0);
  });
  it('after the restatement, corrected figures are used', () => {
    const r = resolve13F(db, M1, '2025-12-31', '2026-02-21T00:00:00.000Z')!;
    expect(r.positions.get(CUSIP)!.shares).toBe(150);
    expect(r.positions.has(OTHER)).toBe(false);
  });
  it('NEW HOLDINGS amendments only appear once accepted', () => {
    expect(resolve13F(db, M1, '2025-12-31', '2026-03-01T00:00:00.000Z')!.positions.has(OTHER)).toBe(true);
  });
  it('period-over-period changes are computed with the cutoff applied to both periods', () => {
    const early = computeManagerChanges(db, M1, 'Alpha', '2025-12-31', '2026-02-15T00:00:00.000Z')!;
    const late = computeManagerChanges(db, M1, 'Alpha', '2025-12-31', '2026-03-01T00:00:00.000Z')!;
    expect(early.changes.find((c) => c.cusip === CUSIP)!.shareChangePct).toBeCloseTo(9);
    const c = late.changes.find((x) => x.cusip === CUSIP)!;
    expect(c.kind).toBe('increased');
    expect(c.shareChangePct).toBeCloseTo(0.5);
    expect(c.valueChangeFromShares + c.valueChangeFromPrice).toBeCloseTo(c.valueChange);
    expect(late.changes.find((x) => x.cusip === OTHER)!.kind).toBe('new');
  });
  it('detects exits and does not classify changes without a prior filing', () => {
    file13F(db, { manager: M2, period: '2025-12-31', acceptedAt: '2026-02-12T21:00:00.000Z', rows: [{ cusip: CUSIP, shares: 10, value: 100 }] });
    const first = computeManagerChanges(db, M2, 'Beta', '2025-12-31', '2026-03-01T00:00:00.000Z')!;
    expect(first.priorPeriod).toBeNull();
    expect(first.changes[0].kind).toBe('unchanged');
  });
  it('picks the comparable period that most tracked managers have filed', () => {
    expect(comparablePeriod(db, '2026-03-01T00:00:00.000Z').period).toBe('2025-12-31');
    expect(comparablePeriod(db, '2026-01-01T00:00:00.000Z').period).toBe('2025-09-30');
  });
});
