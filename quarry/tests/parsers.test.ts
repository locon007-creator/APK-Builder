import { describe, expect, it } from 'vitest';
import { parse13FCover, parse13FInformationTable, validate13F, valueMultiplierForFilingDate, edgarDate } from '../server/sec/parse13f.ts';
import { parseForm4 } from '../server/sec/parseForm4.ts';
import { parseSchedule13Xml } from '../server/sec/parseSchedule13.ts';
import { acceptanceToUtc, parseSubmissions, rawForm4Document } from '../server/sec/submissions.ts';
import { baseForm, normalizeAccession, padCik } from '../server/sec/ids.ts';
import { parseFiledBy } from '../server/sec/ingest.ts';
import { schedule13Xml } from '../server/demo/xmlgen.ts';
import { COVER_RESTATEMENT, FORM4_MIXED, INFO_TABLE_PREFIXED, SUBMISSIONS } from './fixtures/edgar.ts';

describe('13F information table parsing', () => {
  const t = parse13FInformationTable(INFO_TABLE_PREFIXED, '2025-08-14');
  it('parses namespace-prefixed rows and skips incomplete ones with a warning', () => {
    expect(t.rows).toHaveLength(4);
    expect(t.warnings).toEqual([expect.stringContaining('Row 5')]);
  });
  it('normalises CUSIPs and preserves put/call and principal rows', () => {
    expect(t.rows[0].cusip).toBe('037833100');
    expect(t.rows[2].putCall).toBe('CALL');
    expect(t.rows[3].shPrnType).toBe('PRN');
    expect(t.rows[3].cusip).toBe('00000A109');
  });
  it('applies the 2023 value-unit rule (dollars after 2023-01-03, thousands before)', () => {
    expect(valueMultiplierForFilingDate('2023-01-03')).toBe(1);
    expect(valueMultiplierForFilingDate('2022-11-14')).toBe(1000);
    const old = parse13FInformationTable(INFO_TABLE_PREFIXED, '2022-11-14');
    expect(old.rows[0].valueUsd).toBe(1_500_000_000);
    expect(t.rows[0].valueUsd).toBe(1_500_000);
  });
  it('rejects documents that are not information tables', () => {
    expect(() => parse13FInformationTable('<foo/>', '2025-01-01')).toThrow(/informationTable/);
  });
});

describe('13F cover page', () => {
  const c = parse13FCover(COVER_RESTATEMENT);
  it('reads period and amendment type', () => {
    expect(c.periodOfReport).toBe('2025-06-30');
    expect(c.isAmendment).toBe(true);
    expect(c.amendmentType).toBe('RESTATEMENT');
    expect(c.managerName).toBe('Example Capital LLC');
  });
  it('validates totals against the table', () => {
    const t = parse13FInformationTable(INFO_TABLE_PREFIXED, '2025-08-14');
    expect(validate13F(t, c)).toEqual([]);
    expect(validate13F(t, { ...c, tableEntryTotal: 9 })).toEqual([expect.stringContaining('9 entries')]);
    expect(validate13F(t, { ...c, tableValueTotal: 2349 })[0]).toMatch(/unit error/);
  });
  it('converts EDGAR dates', () => {
    expect(edgarDate('12-31-2024')).toBe('2024-12-31');
    expect(edgarDate('2024-12-31T00:00')).toBe('2024-12-31');
    expect(edgarDate('garbage')).toBeNull();
  });
});

describe('Form 4 parsing', () => {
  const f = parseForm4(FORM4_MIXED);
  it('reads issuer, joint owners and roles', () => {
    expect(f.issuerCik).toBe('0000320193');
    expect(f.issuerTicker).toBe('AAPL');
    expect(f.owners).toHaveLength(2);
    expect(f.owners[0]).toMatchObject({ cik: '0001234567', role: 'Chief Financial Officer' });
    expect(f.owners[1].role).toBe('Trust');
  });
  it('reads non-derivative and derivative transactions with numeric cleanup', () => {
    expect(f.transactions).toHaveLength(4);
    expect(f.transactions[0]).toMatchObject({ code: 'P', shares: 1000, price: 201.25, acquiredDisposed: 'A', isDerivative: false, footnotes: ['fn'] });
    expect(f.transactions[2]).toMatchObject({ code: 'A', price: null, directOrIndirect: 'I' });
    expect(f.transactions[3]).toMatchObject({ code: 'P', isDerivative: true });
    expect(f.is10b51).toBe(false);
  });
  it('rejects non-ownership documents', () => {
    expect(() => parseForm4('<x/>')).toThrow(/ownershipDocument/);
  });
});

describe('Schedule 13D/G parsing', () => {
  it('extracts percent, shares and event date', () => {
    const p = parseSchedule13Xml(schedule13Xml({ issuerCik: '123', percent: 7.25, shares: 1000, eventDate: '2025-03-01', purpose: 'Engage' }));
    expect(p).toMatchObject({ issuerCik: '0000000123', percentOfClass: 7.25, shares: 1000, eventDate: '2025-03-01', status: 'parsed' });
  });
  it('degrades to partial when the percentage is missing', () => {
    expect(parseSchedule13Xml('<edgarSubmission><x>1</x></edgarSubmission>').status).toBe('partial');
  });
  it('reads FILED BY from the SGML header', () => {
    const h = `SUBJECT COMPANY:\n COMPANY CONFORMED NAME: TARGET INC\n CENTRAL INDEX KEY: 0000000111\nFILED BY:\n COMPANY DATA:\n  COMPANY CONFORMED NAME: ACTIVIST LP\n  CENTRAL INDEX KEY: 0000000222`;
    expect(parseFiledBy(h)).toEqual({ cik: '0000000222', name: 'ACTIVIST LP' });
    expect(parseFiledBy('nothing')).toBeNull();
  });
});

describe('EDGAR submissions and identifiers', () => {
  it('normalises identifiers and form families', () => {
    expect(padCik(320193)).toBe('0000320193');
    expect(normalizeAccession('000032019325000010')).toBe('0000320193-25-000010');
    expect(() => normalizeAccession('bad')).toThrow();
    expect(baseForm('13F-HR/A')).toEqual({ base: '13F-HR', isAmendment: true });
    expect(baseForm('SCHEDULE 13D/A')).toEqual({ base: 'SC 13D', isAmendment: true });
  });
  it('converts Eastern acceptance wall-clock to UTC across DST', () => {
    expect(acceptanceToUtc('2025-02-14T16:05:12.000Z')).toBe('2025-02-14T21:05:12.000Z'); // EST
    expect(acceptanceToUtc('2025-08-14T16:05:12.000Z')).toBe('2025-08-14T20:05:12.000Z'); // EDT
  });
  it('filters forms and parses 8-K items', () => {
    const rows = parseSubmissions(SUBMISSIONS({ cik: '1', name: 'X', rows: [
      { acc: '0000000001-25-000001', form: '8-K', filed: '2025-05-01', report: '2025-04-30', accepted: '2025-05-01T17:00:00.000Z', doc: 'a.htm', items: '2.02,9.01' },
      { acc: '0000000001-25-000002', form: '10-Q', filed: '2025-05-01', report: '2025-03-31', accepted: '2025-05-01T17:00:00.000Z', doc: 'q.htm' },
    ] }) as never, new Set(['8-K']));
    expect(rows).toHaveLength(1);
    expect(rows[0].items).toEqual(['2.02', '9.01']);
  });
  it('strips the XSL rendering prefix from Form 4 documents', () => {
    expect(rawForm4Document('xslF345X05/wk-form4_1.xml')).toBe('wk-form4_1.xml');
  });
});
