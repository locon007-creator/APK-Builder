import { describe, expect, it } from 'vitest';
import { classifyForm4, isQualifyingOpenMarketPurchase, FORM4_CODES } from '../server/domain/form4Codes.ts';
import { listEvents, listInsiderTransactions, effectiveForm4Accessions, form4Detail } from '../server/domain/queries.ts';
import { dedupeEvents } from '../server/domain/radar.ts';
import { eventRelevance, headlineFor8K } from '../server/domain/events8k.ts';
import { freshDb, file4, file8K } from './helpers.ts';

describe('Form 4 transaction-code interpretation', () => {
  it.each([
    ['P', false, 'open_market_purchase'], ['S', false, 'open_market_sale'], ['A', false, 'award'], ['M', false, 'option_exercise'],
    ['X', false, 'option_exercise'], ['F', false, 'tax_withholding'], ['G', false, 'gift'], ['D', false, 'disposition_to_issuer'],
    ['C', false, 'conversion'], ['J', false, 'other'], ['P', true, 'other'], ['S', true, 'other'],
  ])('code %s (derivative=%s) → %s', (code, deriv, cls) => {
    expect(classifyForm4(code as string, deriv as boolean).cls).toBe(cls);
  });
  it('labels unknown codes rather than guessing', () => {
    expect(classifyForm4('Q', false)).toMatchObject({ cls: 'other', codeLabel: expect.stringContaining('Unrecognised') });
  });
  it('only treats priced, non-derivative, non-plan code-P acquisitions as qualifying purchases', () => {
    const base = { code: 'P', isDerivative: false, acquiredDisposed: 'A', shares: 10, price: 5, is10b51: false };
    expect(isQualifyingOpenMarketPurchase(base)).toBe(true);
    expect(isQualifyingOpenMarketPurchase({ ...base, code: 'A' })).toBe(false);
    expect(isQualifyingOpenMarketPurchase({ ...base, code: 'M' })).toBe(false);
    expect(isQualifyingOpenMarketPurchase({ ...base, isDerivative: true })).toBe(false);
    expect(isQualifyingOpenMarketPurchase({ ...base, price: null })).toBe(false);
    expect(isQualifyingOpenMarketPurchase({ ...base, is10b51: true })).toBe(false);
    expect(isQualifyingOpenMarketPurchase({ ...base, acquiredDisposed: 'D' })).toBe(false);
  });
  it('covers every code in the SEC instruction list', () => {
    expect(Object.keys(FORM4_CODES).sort().join('')).toBe('ACDEFGHIJKLMOPSUVWXZ');
  });
});

describe('Form 4 amendments and duplicates (date-safe)', () => {
  const db = freshDb();
  const OWNER = '0000000301';
  file4(db, { owner: OWNER, acceptedAt: '2026-02-03T21:00:00.000Z', txns: [{ date: '2026-02-02', code: 'P', ad: 'A', shares: 5000, price: 10, after: 15000 }], accession: '0000000301-26-000001' });
  file4(db, { owner: OWNER, acceptedAt: '2026-02-10T21:00:00.000Z', amendment: true, txns: [{ date: '2026-02-02', code: 'P', ad: 'A', shares: 3500, price: 10, after: 13500 }], accession: '0000000301-26-000002' });
  // A separate owner files the same transaction twice (duplicate submission).
  file4(db, { owner: '0000000302', acceptedAt: '2026-02-04T21:00:00.000Z', txns: [{ date: '2026-02-03', code: 'P', ad: 'A', shares: 100, price: 9, after: 100 }], accession: '0000000302-26-000001', period: '2026-02-03' });
  file4(db, { owner: '0000000302', acceptedAt: '2026-02-04T22:00:00.000Z', txns: [{ date: '2026-02-03', code: 'P', ad: 'A', shares: 100, price: 9, after: 100 }], accession: '0000000302-26-000002', period: '2026-02-03' });

  it('before the 4/A is accepted, the original figures are used', () => {
    const t = listInsiderTransactions(db, { asOf: '2026-02-05T00:00:00.000Z' }).filter((x) => x.ownerCik === OWNER);
    expect(t.map((x) => x.shares)).toEqual([5000]);
  });
  it('after the 4/A is accepted, it replaces the original and is counted once', () => {
    const t = listInsiderTransactions(db, { asOf: '2026-03-01T00:00:00.000Z' }).filter((x) => x.ownerCik === OWNER);
    expect(t.map((x) => x.shares)).toEqual([3500]);
    expect(form4Detail(db, '0000000301-26-000001', '2026-03-01T00:00:00.000Z').supersededBy).toBe('0000000301-26-000002');
    expect(form4Detail(db, '0000000301-26-000001', '2026-02-05T00:00:00.000Z').supersededBy).toBeNull();
  });
  it('identical transactions reported in two submissions are counted once', () => {
    expect(listInsiderTransactions(db, { asOf: '2026-03-01T00:00:00.000Z' }).filter((x) => x.ownerCik === '0000000302')).toHaveLength(1);
  });
  it('keeps all originals when no amendment exists', () => {
    const keep = effectiveForm4Accessions([
      { accession: 'a', subject_cik: 'i', filer_cik: 'o', period_of_report: 'p1', is_amendment: 0, accepted_at: '1' },
      { accession: 'b', subject_cik: 'i', filer_cik: 'o', period_of_report: 'p2', is_amendment: 0, accepted_at: '2' },
    ]);
    expect([...keep].sort()).toEqual(['a', 'b']);
  });
});

describe('8-K events', () => {
  it('scores relevance by the most relevant item and ignores exhibits-only', () => {
    expect(eventRelevance(['2.02', '9.01'])).toBe(0.8);
    expect(eventRelevance(['9.01'])).toBe(0.1);
    expect(headlineFor8K(['9.01', '1.05'])).toMatch(/cybersecurity/i);
  });
  it('merges 8-K/A into the original event and respects the cutoff', () => {
    const db = freshDb();
    file8K(db, { items: ['2.02', '9.01'], acceptedAt: '2026-02-20T21:00:00.000Z', eventDate: '2026-02-20' });
    file8K(db, { items: ['2.02', '9.01'], acceptedAt: '2026-02-22T21:00:00.000Z', eventDate: '2026-02-20', amendment: true });
    expect(listEvents(db, { asOf: '2026-02-21T00:00:00.000Z' })).toHaveLength(1);
    const all = listEvents(db, { asOf: '2026-03-01T00:00:00.000Z' });
    expect(all).toHaveLength(2);
    expect(dedupeEvents(all)).toHaveLength(1);
    expect(dedupeEvents(all)[0].isAmendment).toBe(false);
  });
});
