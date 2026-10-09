import { describe, expect, it } from 'vitest';
import { all, one, openDb } from '../server/db/index.ts';
import { storeFiling, write13FRows } from '../server/sec/store.ts';
import { parse13FInformationTable } from '../server/sec/parse13f.ts';
import { SecClient } from '../server/sec/client.ts';
import { ingest, type Universe } from '../server/sec/ingest.ts';
import { evaluateAlerts, listAlerts, webhookAdapter } from '../server/domain/alerts.ts';
import { buildRadar } from '../server/domain/radar.ts';
import { seedDemo } from '../server/demo/seed.ts';
import { DemoMarketDataProvider } from '../server/market/demo.ts';
import { NoMarketDataProvider } from '../server/market/provider.ts';
import { PolygonProvider } from '../server/market/http.ts';
import { marketContext, eventWindowMove } from '../server/market/stats.ts';
import { coverXml, form4Xml, infoTableXml } from '../server/demo/xmlgen.ts';
import { freshDb, file13F, M1, CUSIP, NOW } from './helpers.ts';
import { INFO_TABLE_PREFIXED, SUBMISSIONS } from './fixtures/edgar.ts';

describe('duplicate filing detection and idempotent storage', () => {
  it('re-storing identical content is a no-op; a parser upgrade reparses and records the correction', () => {
    const db = freshDb();
    const t = parse13FInformationTable(INFO_TABLE_PREFIXED, '2025-08-14');
    const header = { accession: '0000000101-25-000099', filerCik: M1, subjectCik: null, formType: '13F-HR', baseForm: '13F-HR', isAmendment: false, periodOfReport: '2025-06-30', filingDate: '2025-08-14', acceptedAt: '2025-08-14T20:00:00.000Z', sourceUrl: null, parserVersion: 'v1', origin: 'sec' as const };
    const rows = () => ({ rows: write13FRows(db, header.accession, M1, '2025-06-30', t.rows), status: 'parsed' as const });
    expect(storeFiling(db, header, INFO_TABLE_PREFIXED, rows, ['holdings_13f'], NOW)).toBe('new');
    expect(storeFiling(db, header, INFO_TABLE_PREFIXED, rows, ['holdings_13f'], NOW)).toBe('unchanged');
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM holdings_13f')!.n).toBe(4);
    expect(storeFiling(db, { ...header, parserVersion: 'v2' }, INFO_TABLE_PREFIXED, rows, ['holdings_13f'], NOW)).toBe('reparsed');
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM holdings_13f')!.n).toBe(4);
    const runs = all<{ parser_version: string; superseded_rows: number }>(db, 'SELECT parser_version, superseded_rows FROM parse_runs ORDER BY id');
    expect(runs).toEqual([{ parser_version: 'v1', superseded_rows: 0 }, { parser_version: 'v2', superseded_rows: 4 }].map((r) => expect.objectContaining(r)));
    expect(one(db, 'SELECT ingested_at FROM filings')).toMatchObject({ ingested_at: NOW });
  });
  it('a parse failure is recorded, not thrown, and is retried next time', () => {
    const db = freshDb();
    const header = { accession: '0000000101-25-000100', filerCik: M1, subjectCik: null, formType: '13F-HR', baseForm: '13F-HR', isAmendment: false, periodOfReport: '2025-06-30', filingDate: '2025-08-14', acceptedAt: '2025-08-14T20:00:00.000Z', sourceUrl: null, parserVersion: 'v1', origin: 'sec' as const };
    storeFiling(db, header, 'x', () => { throw new Error('boom'); }, ['holdings_13f'], NOW);
    expect(one(db, 'SELECT parse_status, parse_error FROM filings')).toMatchObject({ parse_status: 'failed', parse_error: 'boom' });
    expect(storeFiling(db, header, 'x', () => ({ rows: 0, status: 'parsed' }), ['holdings_13f'], NOW)).toBe('reparsed');
  });
});

describe('alert deduplication', () => {
  it('re-evaluation, re-ingestion and amendments do not duplicate alerts; delivery is reported honestly', async () => {
    const db = freshDb();
    db.prepare(`INSERT INTO workspaces (id, created_at) VALUES ('w1', ?)`).run(NOW);
    db.prepare(`INSERT INTO alert_rules (workspace_id, name, type, target_kind, target_id, created_at, updated_at) VALUES ('w1', 'filings', 'new_filing', 'manager', ?, ?, ?)`).run(M1, NOW, NOW);
    db.prepare(`INSERT INTO alert_rules (workspace_id, name, type, target_kind, target_id, created_at, updated_at) VALUES ('w1', 'newpos', 'new_position', 'any', NULL, ?, ?)`).run(NOW, NOW);
    file13F(db, { manager: M1, period: '2025-09-30', acceptedAt: '2025-11-10T21:00:00.000Z', rows: [{ cusip: '000000999', shares: 1, value: 1, name: 'OTHER' }] });
    file13F(db, { manager: M1, period: '2025-12-31', acceptedAt: '2026-02-20T21:00:00.000Z', rows: [{ cusip: CUSIP, shares: 100, value: 1000 }], accession: '0000000101-26-900001' });
    const failing = webhookAdapter('https://hooks.example/x', (async () => new Response('', { status: 500 })) as typeof fetch);
    const r1 = await evaluateAlerts(db, { now: NOW, adapters: [failing] });
    expect(r1.created).toBe(2); // one filing alert, one new-position alert
    // same filing re-stored (re-ingestion) + a restatement of the same period
    file13F(db, { manager: M1, period: '2025-12-31', acceptedAt: '2026-02-20T21:00:00.000Z', rows: [{ cusip: CUSIP, shares: 100, value: 1000 }], accession: '0000000101-26-900001' });
    file13F(db, { manager: M1, period: '2025-12-31', acceptedAt: '2026-02-25T21:00:00.000Z', amendmentType: 'RESTATEMENT', rows: [{ cusip: CUSIP, shares: 120, value: 1200 }] });
    const r2 = await evaluateAlerts(db, { now: NOW, adapters: [failing] });
    expect(r2.created).toBe(0);
    expect(r2.skippedDuplicates).toBeGreaterThan(0);
    const alerts = listAlerts(db, 'w1');
    expect(alerts).toHaveLength(2);
    expect(alerts[0].deliveryStatus).toEqual([
      expect.objectContaining({ channel: 'in_app', status: 'delivered' }),
      expect.objectContaining({ channel: 'webhook', status: 'failed' }),
    ]);
    expect(alerts.every((a) => a.filingAcceptedAt && a.detectedAt === NOW)).toBe(true);
  });
  it('an unconfigured external channel is reported as not configured, never as sent', async () => {
    const r = await webhookAdapter('').deliver({ title: 't', body: 'b', sourceUrl: null, accession: null });
    expect(r.status).toBe('not_configured');
  });
});

describe('radar on the demo dataset', () => {
  const anchor = new Date('2026-10-09T02:00:00.000Z');
  const db = openDb(':memory:');
  seedDemo(db, anchor);
  const market = new DemoMarketDataProvider(db);

  it('surfaces candidates with evidence, timestamps and complete ranking explanations', async () => {
    const r = await buildRadar({ db, asOf: anchor.toISOString(), now: anchor.toISOString(), market, watchIssuers: new Set() });
    expect(r.period).toBe('2026-06-30');
    expect(r.candidates.length).toBeGreaterThan(10);
    for (const c of r.candidates) {
      expect(c.evidence.length).toBeGreaterThan(0);
      expect(c.limitations.length).toBeGreaterThan(0);
      expect(c.ranking.inputs.length).toBeGreaterThan(2);
      expect(c.freshness.status).toBe('demo');
      expect(c.latestAcceptedAt <= anchor.toISOString()).toBe(true);
    }
    const insider = r.candidates.find((c) => c.category === 'insider_buying' && c.ticker === 'IBBK')!;
    expect(insider.supportingCount).toBe(3);
    // HLMD: awards/exercises/gifts never count; only the amended director purchase (3,500 sh) does.
    const hl = r.candidates.find((c) => c.category === 'insider_buying' && c.ticker === 'HLMD')!;
    expect(hl.evidence).toHaveLength(1);
    expect(hl.evidence[0].summary).toMatch(/3,500 sh/);
    expect(r.candidates.find((c) => c.category === 'insider_buying' && c.ticker === 'PCFD')).toBeUndefined(); // 10b5-1 plan
  });
  it('is reproducible: same cutoff → same candidates and scores, whatever the wall clock', async () => {
    const asOf = '2026-09-01T00:00:00.000Z';
    const a = await buildRadar({ db, asOf, now: anchor.toISOString(), market, watchIssuers: new Set() });
    const b = await buildRadar({ db, asOf, now: '2027-05-05T00:00:00.000Z', market, watchIssuers: new Set() });
    expect(b.candidates.map((c) => [c.id, c.ranking.score])).toEqual(a.candidates.map((c) => [c.id, c.ranking.score]));
  });
  it('a historical cutoff never uses later filings', async () => {
    const asOf = '2026-08-01T00:00:00.000Z'; // before the 2026-06-30 13Fs were due
    const r = await buildRadar({ db, asOf, now: anchor.toISOString(), market, watchIssuers: new Set() });
    expect(r.period).toBe('2026-03-31');
    for (const c of r.candidates) for (const e of c.evidence) if (e.acceptedAt) expect(e.acceptedAt <= asOf).toBe(true);
    expect(r.candidates.some((c) => c.category === 'insider_buying' && c.ticker === 'IBBK')).toBe(false);
  });
  it('marks unusual-market as unavailable without a provider and keeps the rest working', async () => {
    const r = await buildRadar({ db, asOf: anchor.toISOString(), now: anchor.toISOString(), market: new NoMarketDataProvider(), watchIssuers: new Set() });
    expect(r.categoryStatus.unusual_market.available).toBe(false);
    expect(r.candidates.some((c) => c.category === 'unusual_market')).toBe(false);
    const c = r.candidates.find((x) => x.category === 'institutional_accumulation')!;
    expect(c.ranking.missing).toContain('Market context');
    expect(c.hasMarketConfirmation).toBe(false);
  });
});

describe('market data look-ahead protection', () => {
  it('demo provider never returns bars after the cutoff', async () => {
    const db = openDb(':memory:');
    seedDemo(db, new Date('2026-10-09T02:00:00.000Z'));
    const h = await new DemoMarketDataProvider(db).getHistory('AURS', '2026-01-01', '2026-06-30T12:00:00Z');
    expect(h!.bars.at(-1)!.date <= '2026-06-30').toBe(true);
    expect(h!.isDemo).toBe(true);
  });
  it('HTTP providers drop bars past the cutoff and return null on errors', async () => {
    const fake = (async () => new Response(JSON.stringify({ results: [
      { t: Date.parse('2026-01-02T00:00:00Z'), o: 1, h: 1, l: 1, c: 1, v: 10 },
      { t: Date.parse('2026-01-05T00:00:00Z'), o: 2, h: 2, l: 2, c: 2, v: 10 },
    ] }), { status: 200 })) as typeof fetch;
    const p = new PolygonProvider('key', 15, fake);
    const h = await p.getHistory('X', '2026-01-01', '2026-01-03T00:00:00Z');
    expect(h!.bars.map((b) => b.date)).toEqual(['2026-01-02']);
    expect(h!.isDemo).toBe(false);
    const broken = new PolygonProvider('key', 15, (async () => new Response('', { status: 503 })) as typeof fetch);
    expect(await broken.getHistory('X', '2026-01-01', '2026-01-03')).toBeNull();
    expect(new PolygonProvider('', 15).status().configured).toBe(false);
  });
  it('computes statistics and event windows from supplied bars only', () => {
    const bars = Array.from({ length: 60 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, open: 10, high: 10, low: 10, close: 10 + (i % 2) * 0.1, volume: 1000 + (i % 3) }));
    bars.push({ date: '2026-03-02', open: 10, high: 12, low: 10, close: 12, volume: 9000 });
    const mc = marketContext(bars)!;
    expect(mc.volumeZ!).toBeGreaterThan(3);
    expect(mc.trend).toBe('above_50d');
    expect(eventWindowMove(bars, '2026-03-02', 5)!.move).toBeCloseTo(12 / bars[59].close - 1);
    expect(eventWindowMove(bars, '2027-01-01')).toBeNull();
  });
});

describe('SEC client', () => {
  it('requires a descriptive User-Agent', () => {
    expect(() => new SecClient({ userAgent: '' })).toThrow(/SEC_USER_AGENT/);
  });
  it('retries 429 honouring Retry-After, sends the User-Agent and throttles', async () => {
    const calls: { ua: string | null }[] = [];
    const sleeps: number[] = [];
    let n = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      calls.push({ ua: new Headers(init?.headers).get('user-agent') });
      return ++n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '2' } }) : new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    const c = new SecClient({ userAgent: 'Test Co test@example.com', fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    expect(await c.getJson('https://data.sec.gov/x')).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].ua).toBe('Test Co test@example.com');
    expect(sleeps).toContain(2000);
  });
  it('gives up after max retries and surfaces 404 immediately', async () => {
    const c = new SecClient({ userAgent: 'a b@c.d', maxRetries: 1, fetchImpl: (async () => new Response('', { status: 503 })) as typeof fetch, sleep: async () => {} });
    await expect(c.get('https://x')).rejects.toThrow(/503 after 2 attempts/);
    const c404 = new SecClient({ userAgent: 'a b@c.d', fetchImpl: (async () => new Response('', { status: 404 })) as typeof fetch, sleep: async () => {} });
    await expect(c404.get('https://x')).rejects.toMatchObject({ status: 404 });
  });
});

describe('end-to-end ingestion with a mocked EDGAR', () => {
  const MGR = '1111111';
  const ISS = '2222222';
  const acc13f = '0001111111-26-000001';
  const acc4 = '0000999999-26-000002';
  const acc8k = '0002222222-26-000003';
  const routes: Record<string, string> = {
    [`https://data.sec.gov/submissions/CIK000${MGR}.json`]: JSON.stringify(SUBMISSIONS({ cik: MGR, name: 'Mock Capital LP', rows: [
      { acc: acc13f, form: '13F-HR', filed: '2026-02-12', report: '2025-12-31', accepted: '2026-02-12T16:30:00.000Z', doc: 'primary_doc.xml' },
    ] })),
    [`https://www.sec.gov/Archives/edgar/data/${MGR}/${acc13f.replace(/-/g, '')}/index.json`]: JSON.stringify({ directory: { item: [{ name: 'primary_doc.xml' }, { name: 'infotable.xml' }, { name: `${acc13f}-index.html` }] } }),
    [`https://www.sec.gov/Archives/edgar/data/${MGR}/${acc13f.replace(/-/g, '')}/primary_doc.xml`]: coverXml({ managerName: 'Mock Capital LP', period: '2025-12-31', entries: 2, total: 3000 }),
    [`https://www.sec.gov/Archives/edgar/data/${MGR}/${acc13f.replace(/-/g, '')}/infotable.xml`]: infoTableXml([{ name: 'MOCK ISSUER INC', cusip: '22222210 1'.replace(' ', ''), shares: 100, value: 2000 }, { name: 'UNKNOWN THING', cusip: '999999999', shares: 5, value: 1000 }]),
    [`https://data.sec.gov/submissions/CIK000${ISS}.json`]: JSON.stringify(SUBMISSIONS({ cik: ISS, name: 'Mock Issuer Inc', rows: [
      { acc: acc4, form: '4', filed: '2026-02-20', report: '2026-02-19', accepted: '2026-02-20T17:00:00.000Z', doc: 'xslF345X05/form4.xml' },
      { acc: acc8k, form: '8-K', filed: '2026-02-21', report: '2026-02-21', accepted: '2026-02-21T08:00:00.000Z', doc: 'ev.htm', items: '2.02,9.01' },
      { acc: '0002222222-20-000009', form: '8-K', filed: '2020-01-01', report: '2020-01-01', accepted: '2020-01-01T08:00:00.000Z', doc: 'old.htm', items: '8.01' },
    ] })),
    [`https://www.sec.gov/Archives/edgar/data/${ISS}/${acc4.replace(/-/g, '')}/form4.xml`]: form4Xml({ issuerCik: ISS, issuerName: 'Mock Issuer Inc', ticker: 'MOCK', ownerCik: '999999', ownerName: 'Insider One', role: { director: true }, period: '2026-02-19', txns: [{ date: '2026-02-19', code: 'P', ad: 'A', shares: 1000, price: 20, after: 5000 }] }),
  };
  const fetchImpl = (async (url: string) => routes[url] ? new Response(routes[url], { status: 200 }) : new Response('', { status: 404 })) as typeof fetch;
  const universe: Universe = { managers: [{ cik: MGR, name: 'Mock Capital' }], issuers: [{ cik: ISS, ticker: 'MOCK', name: 'Mock Issuer Inc', sector: 'Tech', cusips: ['222222101'] }], lookbackDays: 120 };

  it('ingests 13F, Form 4 and 8-K, maps CUSIPs, logs errors, and is idempotent', async () => {
    const db = openDb(':memory:');
    const client = new SecClient({ userAgent: 'Test test@example.com', fetchImpl, sleep: async () => {} });
    const now = () => new Date('2026-03-01T00:00:00.000Z');
    const s1 = await ingest({ db, client, universe, now, only: ['13f', 'events', 'fundamentals'] });
    expect(s1.created).toBe(3);
    expect(s1.errors).toBe(1); // fundamentals endpoint 404 is logged, not fatal
    const f = all<{ accession: string; accepted_at: string; parse_status: string; ingested_at: string }>(db, 'SELECT accession, accepted_at, parse_status, ingested_at FROM filings ORDER BY accession');
    expect(f.find((x) => x.accession === acc13f)).toMatchObject({ accepted_at: '2026-02-12T21:30:00.000Z', parse_status: 'parsed', ingested_at: '2026-03-01T00:00:00.000Z' });
    expect(f.some((x) => x.accession.endsWith('20-000009'))).toBe(false); // outside lookback
    expect(one(db, `SELECT mapping_source FROM securities WHERE cusip = '999999999'`)).toMatchObject({ mapping_source: 'unmapped' });
    expect(one(db, `SELECT issuer_cik FROM securities WHERE cusip = '222222101'`)).toMatchObject({ issuer_cik: '0002222222' });
    expect(one(db, `SELECT code, shares FROM insider_transactions`)).toMatchObject({ code: 'P', shares: 1000 });
    expect(one(db, `SELECT items FROM filings WHERE accession = ?`, acc8k)).toMatchObject({ items: '2.02,9.01' });
    expect(all(db, 'SELECT * FROM ingestion_errors')).toHaveLength(1);
    const s2 = await ingest({ db, client, universe, now, only: ['13f', 'events'] });
    expect(s2.created).toBe(0);
    expect(s2.unchanged).toBe(3);
    expect(one<{ n: number }>(db, 'SELECT COUNT(*) n FROM holdings_13f')!.n).toBe(2);
  });
});
