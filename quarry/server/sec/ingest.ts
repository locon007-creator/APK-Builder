import { type DB, all, one, setMeta } from '../db/index.ts';
import { SecClient, SecHttpError } from './client.ts';
import { filingIndexUrl, filingDocumentUrl, normalizeCusip, padCik } from './ids.ts';
import { parseSubmissions, rawForm4Document, submissionsUrl, type SubmissionEntry, type SubmissionsJson } from './submissions.ts';
import { PARSER_13F_VERSION, parse13FCover, parse13FInformationTable, validate13F } from './parse13f.ts';
import { PARSER_FORM4_VERSION, parseForm4 } from './parseForm4.ts';
import { PARSER_SCHEDULE13_VERSION, parseSchedule13Xml } from './parseSchedule13.ts';
import { storeFiling, upsertEntity, upsertSecurity, write13FRows, writeForm4Rows, writeOwnershipDisclosure, type StoreOutcome } from './store.ts';
import { clear13FCache } from '../domain/thirteenF.ts';

export interface Universe {
  managers: { cik: string; name: string }[];
  issuers: { cik: string; ticker: string; name: string; sector?: string; cusips: string[] }[];
  lookbackDays?: number;      // event filings (4 / 8-K / 13D / 13G)
  periodsBack?: number;       // 13F quarters per manager
}

export interface IngestOptions {
  db: DB;
  client: SecClient;
  universe: Universe;
  now?: () => Date;
  log?: (msg: string) => void;
  only?: ('13f' | 'events' | 'fundamentals')[];
}

export interface IngestSummary { runId: number; seen: number; created: number; reparsed: number; unchanged: number; errors: number }

const FUNDAMENTAL_CONCEPTS: { taxonomy: 'us-gaap' | 'dei'; concept: string; label: string; unit: string }[] = [
  { taxonomy: 'us-gaap', concept: 'Revenues', label: 'Revenue', unit: 'USD' },
  { taxonomy: 'us-gaap', concept: 'RevenueFromContractWithCustomerExcludingAssessedTax', label: 'Revenue', unit: 'USD' },
  { taxonomy: 'us-gaap', concept: 'NetIncomeLoss', label: 'Net income', unit: 'USD' },
  { taxonomy: 'us-gaap', concept: 'EarningsPerShareDiluted', label: 'Diluted EPS', unit: 'USD/shares' },
  { taxonomy: 'dei', concept: 'EntityCommonStockSharesOutstanding', label: 'Shares outstanding', unit: 'shares' },
];

export async function ingest(opts: IngestOptions): Promise<IngestSummary> {
  const { db, client, universe } = opts;
  const now = () => (opts.now ? opts.now() : new Date()).toISOString();
  const log = opts.log ?? (() => {});
  const only = new Set(opts.only ?? ['13f', 'events', 'fundamentals']);
  const run = db.prepare(`INSERT INTO ingestion_log (started_at, source, status) VALUES (?, 'sec-edgar', 'running')`).run(now());
  const runId = Number(run.lastInsertRowid);
  const s: IngestSummary = { runId, seen: 0, created: 0, reparsed: 0, unchanged: 0, errors: 0 };
  const tally = (o: StoreOutcome) => { s[o === 'new' ? 'created' : o === 'reparsed' ? 'reparsed' : 'unchanged']++; };
  const fail = (url: string | null, accession: string | null, err: unknown) => {
    s.errors++;
    const msg = err instanceof SecHttpError ? `HTTP ${err.status}: ${err.message}` : (err as Error).message;
    db.prepare('INSERT INTO ingestion_errors (run_id, at, url, accession, message) VALUES (?, ?, ?, ?, ?)').run(runId, now(), url, accession, msg);
    log(`ERROR ${accession ?? url}: ${msg}`);
  };

  // Seed universe entities and CUSIP → issuer mappings (CUSIP, not ticker, is the historical identity key).
  for (const m of universe.managers) upsertEntity(db, { cik: padCik(m.cik), name: m.name, kind: 'manager', tracked: true, origin: 'sec', now: now() });
  for (const i of universe.issuers) {
    upsertEntity(db, { cik: padCik(i.cik), name: i.name, kind: 'issuer', tracked: true, ticker: i.ticker, sector: i.sector ?? null, origin: 'sec', now: now() });
    for (const c of i.cusips) upsertSecurity(db, { cusip: normalizeCusip(c), issuerCik: padCik(i.cik), ticker: i.ticker, name: i.name, mappingSource: 'universe', origin: 'sec' });
  }
  const issuerByName = universe.issuers.map((i) => ({ cik: padCik(i.cik), ticker: i.ticker, key: i.name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) }));

  // ---- 13F ----------------------------------------------------------------
  if (only.has('13f')) {
    for (const m of universe.managers) {
      const cik = padCik(m.cik);
      const url = submissionsUrl(cik);
      try {
        const subs = await client.getJson<SubmissionsJson>(url);
        upsertEntity(db, { cik, name: subs.name, kind: 'manager', tracked: true, origin: 'sec', now: now() });
        const entries = parseSubmissions(subs, new Set(['13F-HR']));
        const periods = [...new Set(entries.map((e) => e.reportDate).filter(Boolean))].sort().reverse().slice(0, universe.periodsBack ?? 4);
        for (const e of entries.filter((x) => x.reportDate && periods.includes(x.reportDate))) {
          s.seen++;
          await ingest13F(db, client, cik, e, now(), issuerByName).then(tally, (err) => fail(filingIndexUrl(cik, e.accession), e.accession, err));
        }
      } catch (err) {
        fail(url, null, err);
      }
    }
  }

  // ---- Issuer event filings ------------------------------------------------
  if (only.has('events')) {
    const cutoff = new Date(Date.parse(now()) - (universe.lookbackDays ?? 120) * 86_400_000).toISOString();
    for (const i of universe.issuers) {
      const cik = padCik(i.cik);
      const url = submissionsUrl(cik);
      try {
        const subs = await client.getJson<SubmissionsJson>(url);
        upsertEntity(db, { cik, name: subs.name, kind: 'issuer', tracked: true, ticker: subs.tickers?.[0] ?? i.ticker, sector: i.sector ?? subs.sicDescription ?? null, origin: 'sec', now: now() });
        const entries = parseSubmissions(subs, new Set(['4', '8-K', 'SC 13D', 'SC 13G'])).filter((e) => e.acceptedAt >= cutoff);
        for (const e of entries) {
          s.seen++;
          const existing = one<{ parse_status: string }>(db, 'SELECT parse_status FROM filings WHERE accession = ?', e.accession);
          if (existing && existing.parse_status !== 'failed') { s.unchanged++; continue; }
          try {
            if (e.baseForm === '4') tally(await ingestForm4(db, client, cik, e, now()));
            else if (e.baseForm === '8-K') tally(store8K(db, cik, e, now()));
            else tally(await ingestSchedule13(db, client, cik, e, now()));
          } catch (err) {
            fail(filingDocumentUrl(cik, e.accession, e.primaryDocument), e.accession, err);
          }
        }
      } catch (err) {
        fail(url, null, err);
      }
    }
  }

  // ---- Fundamentals (XBRL company facts) ----------------------------------
  if (only.has('fundamentals')) {
    for (const i of universe.issuers) {
      const cik = padCik(i.cik);
      const url = `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
      try {
        const facts = await client.getJson<{ facts: Record<string, Record<string, { units: Record<string, { end: string; start?: string; val: number; accn: string; fp?: string; form: string; filed: string }[]> }>> }>(url);
        const ins = db.prepare(`INSERT OR IGNORE INTO fundamentals (issuer_cik, concept, label, unit, period_start, period_end, fiscal_period, value, accession, form, filed, origin)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sec')`);
        for (const c of FUNDAMENTAL_CONCEPTS) {
          const points = facts.facts?.[c.taxonomy]?.[c.concept]?.units?.[c.unit] ?? [];
          for (const p of points.filter((x) => ['10-K', '10-Q', '10-K/A', '10-Q/A'].includes(x.form)).slice(-24)) {
            ins.run(cik, c.concept, c.label, c.unit, p.start ?? null, p.end, p.fp ?? null, p.val, p.accn, p.form, p.filed);
          }
        }
      } catch (err) {
        fail(url, null, err);
      }
    }
  }

  clear13FCache(db);
  setMeta(db, 'data_version', now());
  db.prepare(`UPDATE ingestion_log SET finished_at = ?, status = ?, filings_seen = ?, filings_new = ?, errors = ?, message = ? WHERE id = ?`)
    .run(now(), s.errors ? 'completed_with_errors' : 'completed', s.seen, s.created, s.errors, `${s.created} new, ${s.reparsed} reparsed, ${s.unchanged} unchanged; ${client.requests} SEC requests`, runId);
  return s;
}

async function ingest13F(db: DB, client: SecClient, cik: string, e: SubmissionEntry, now: string, issuerByName: { cik: string; ticker: string; key: string }[]): Promise<StoreOutcome> {
  const base = filingIndexUrl(cik, e.accession);
  const index = await client.getJson<{ directory: { item: { name: string }[] } }>(`${base}index.json`);
  const names = index.directory.item.map((i) => i.name);
  const primary = names.find((n) => n.toLowerCase() === 'primary_doc.xml');
  const table = names.find((n) => n.toLowerCase().endsWith('.xml') && n.toLowerCase() !== 'primary_doc.xml');
  if (!primary || !table) throw new Error(`13F documents not found in index (${names.join(', ')})`);
  const [coverXml, tableXml] = [(await client.get(`${base}${primary}`)).text, (await client.get(`${base}${table}`)).text];
  const cover = parse13FCover(coverXml);
  const parsed = parse13FInformationTable(tableXml, e.filingDate);
  const period = cover.periodOfReport ?? e.reportDate!;
  const issues = [...parsed.warnings, ...validate13F(parsed, cover)];
  const outcome = storeFiling(db, {
    accession: e.accession, filerCik: cik, subjectCik: null, formType: e.form, baseForm: '13F-HR', isAmendment: e.isAmendment,
    amendmentType: cover.amendmentType ?? (e.isAmendment ? 'RESTATEMENT' : null), periodOfReport: period, filingDate: e.filingDate,
    acceptedAt: e.acceptedAt, primaryDocument: table, sourceUrl: `${base}${table}`, indexUrl: base, parserVersion: PARSER_13F_VERSION, origin: 'sec',
  }, coverXml + tableXml, () => ({ rows: write13FRows(db, e.accession, cik, period, parsed.rows), status: issues.length ? 'partial' : 'parsed', message: issues.join('; ') || undefined }), ['holdings_13f'], now);
  // Map CUSIPs not in the universe so they remain visible (flagged) rather than silently mis-joined.
  for (const r of parsed.rows) {
    const known = one(db, 'SELECT 1 FROM securities WHERE cusip = ?', r.cusip);
    if (known) continue;
    const key = r.nameOfIssuer.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    const match = issuerByName.find((i) => i.key && key.startsWith(i.key));
    upsertSecurity(db, { cusip: r.cusip, issuerCik: match?.cik ?? null, ticker: match?.ticker ?? null, name: r.nameOfIssuer, titleOfClass: r.titleOfClass, mappingSource: match ? 'name_match' : 'unmapped', origin: 'sec' });
  }
  return outcome;
}

async function ingestForm4(db: DB, client: SecClient, issuerCik: string, e: SubmissionEntry, now: string): Promise<StoreOutcome> {
  const doc = rawForm4Document(e.primaryDocument);
  const url = filingDocumentUrl(issuerCik, e.accession, doc);
  const xml = (await client.get(url)).text;
  const f = parseForm4(xml);
  for (const o of f.owners) upsertEntity(db, { cik: o.cik, name: o.name, kind: 'person', origin: 'sec', now });
  return storeFiling(db, {
    accession: e.accession, filerCik: f.owners[0]?.cik ?? issuerCik, subjectCik: f.issuerCik, formType: e.form, baseForm: '4', isAmendment: e.isAmendment,
    periodOfReport: f.periodOfReport ?? e.reportDate, filingDate: e.filingDate, acceptedAt: e.acceptedAt, primaryDocument: doc,
    sourceUrl: filingDocumentUrl(issuerCik, e.accession, e.primaryDocument), indexUrl: filingIndexUrl(issuerCik, e.accession), parserVersion: PARSER_FORM4_VERSION, origin: 'sec',
  }, xml, () => ({ rows: writeForm4Rows(db, e.accession, f), status: f.warnings.length ? 'partial' : 'parsed', message: f.warnings.join('; ') || undefined }), ['insider_transactions'], now);
}

function store8K(db: DB, issuerCik: string, e: SubmissionEntry, now: string): StoreOutcome {
  return storeFiling(db, {
    accession: e.accession, filerCik: issuerCik, subjectCik: issuerCik, formType: e.form, baseForm: '8-K', isAmendment: e.isAmendment,
    periodOfReport: e.reportDate, eventDate: e.reportDate, filingDate: e.filingDate, acceptedAt: e.acceptedAt, items: e.items, primaryDocument: e.primaryDocument,
    sourceUrl: filingDocumentUrl(issuerCik, e.accession, e.primaryDocument), indexUrl: filingIndexUrl(issuerCik, e.accession), parserVersion: 'header@1.0.0', origin: 'sec',
  }, JSON.stringify(e), () => ({ rows: 0, status: 'header_only', message: 'Items taken from EDGAR filing metadata; document body not parsed.' }), [], now);
}

/** Read "FILED BY" from the EDGAR SGML header to identify the 13D/13G filer. */
export function parseFiledBy(header: string): { cik: string; name: string } | null {
  const section = header.split(/FILED BY:/i)[1];
  if (!section) return null;
  const name = /COMPANY CONFORMED NAME:\s*(.+)/i.exec(section)?.[1]?.trim();
  const cik = /CENTRAL INDEX KEY:\s*(\d+)/i.exec(section)?.[1];
  return name && cik ? { cik: padCik(cik), name } : null;
}

async function ingestSchedule13(db: DB, client: SecClient, issuerCik: string, e: SubmissionEntry, now: string): Promise<StoreOutcome> {
  const base = filingIndexUrl(issuerCik, e.accession);
  const header = (await client.get(`${base}${e.accession}-index-headers.html`)).text;
  const filer = parseFiledBy(header);
  if (filer) upsertEntity(db, { cik: filer.cik, name: filer.name, kind: 'filer', origin: 'sec', now });
  let parsed: ReturnType<typeof parseSchedule13Xml> | null = null;
  let content = header;
  if (e.primaryDocument.toLowerCase().endsWith('.xml')) {
    const xml = (await client.get(`${base}${rawForm4Document(e.primaryDocument)}`)).text;
    content += xml;
    parsed = parseSchedule13Xml(xml);
  }
  const schedule = e.baseForm === 'SC 13D' ? '13D' : '13G';
  return storeFiling(db, {
    accession: e.accession, filerCik: filer?.cik ?? '0000000000', subjectCik: issuerCik, formType: e.form, baseForm: e.baseForm, isAmendment: e.isAmendment,
    periodOfReport: e.reportDate, eventDate: parsed?.eventDate ?? e.reportDate, filingDate: e.filingDate, acceptedAt: e.acceptedAt, primaryDocument: e.primaryDocument,
    sourceUrl: `${base}${e.primaryDocument}`, indexUrl: base, parserVersion: PARSER_SCHEDULE13_VERSION, origin: 'sec',
  }, content, () => {
    writeOwnershipDisclosure(db, { accession: e.accession, issuerCik, filerCik: filer?.cik ?? '0000000000', schedule, percentOfClass: parsed?.percentOfClass ?? null, shares: parsed?.shares ?? null, eventDate: parsed?.eventDate ?? null, purposeExcerpt: parsed?.purposeExcerpt ?? null });
    return { rows: 1, status: parsed ? parsed.status : 'header_only', message: parsed ? undefined : 'Legacy (non-XML) schedule: header only; percentage not parsed.' };
  }, ['ownership_disclosures'], now);
}

export function ingestionStatus(db: DB) {
  return {
    runs: all(db, 'SELECT * FROM ingestion_log ORDER BY id DESC LIMIT 10'),
    errors: all(db, 'SELECT * FROM ingestion_errors ORDER BY id DESC LIMIT 20'),
    parse: all(db, `SELECT base_form, parse_status, COUNT(*) AS n FROM filings GROUP BY base_form, parse_status ORDER BY base_form`),
    unmappedCusips: (one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM securities WHERE mapping_source = 'unmapped'`)?.n) ?? 0,
  };
}

