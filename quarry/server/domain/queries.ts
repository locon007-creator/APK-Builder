import { type DB, all, one } from '../db/index.ts';
import type { CorporateEvent, DataOrigin, FilingRef, InsiderTransaction } from '../../shared/types.ts';
import { classifyForm4 } from './form4Codes.ts';
import { describeItems, headlineFor8K } from './events8k.ts';
import { classifyFreshness } from './freshness.ts';
import { addDays } from './asof.ts';

export interface EntityRow {
  cik: string;
  name: string;
  kind: string;
  tracked: number;
  ticker: string | null;
  sector: string | null;
  market_cap: number | null;
  market_cap_as_of: string | null;
  description: string | null;
  origin: DataOrigin;
}

export const getEntity = (db: DB, cik: string) => one<EntityRow>(db, 'SELECT * FROM entities WHERE cik = ?', cik);

export function findIssuer(db: DB, idOrTicker: string): EntityRow | undefined {
  const t = idOrTicker.trim();
  if (/^\d+$/.test(t)) return one<EntityRow>(db, `SELECT * FROM entities WHERE cik = ? AND kind = 'issuer'`, t.padStart(10, '0'));
  return one<EntityRow>(db, `SELECT * FROM entities WHERE kind = 'issuer' AND UPPER(ticker) = ?`, t.toUpperCase());
}

// ---------------------------------------------------------------------------
// Filings
// ---------------------------------------------------------------------------

interface FilingDbRow {
  accession: string; form_type: string; base_form: string; is_amendment: number; amendment_type: string | null; filer_cik: string;
  filer_name: string | null; subject_cik: string | null; subject_name: string | null; period_of_report: string | null; filing_date: string;
  accepted_at: string; ingested_at: string; source_url: string | null; parse_status: string; parser_version: string; origin: DataOrigin; items: string | null;
}

const FILING_SELECT = `SELECT f.*, fe.name AS filer_name, se.name AS subject_name FROM filings f
  LEFT JOIN entities fe ON fe.cik = f.filer_cik LEFT JOIN entities se ON se.cik = f.subject_cik`;

function toFilingRef(r: FilingDbRow, now: string): FilingRef {
  return {
    accession: r.accession,
    formType: r.form_type,
    baseForm: r.base_form,
    isAmendment: !!r.is_amendment,
    amendmentType: r.amendment_type,
    filerCik: r.filer_cik,
    filerName: r.filer_name,
    subjectCik: r.subject_cik,
    subjectName: r.subject_name,
    periodOfReport: r.period_of_report,
    filingDate: r.filing_date,
    acceptedAt: r.accepted_at,
    ingestedAt: r.ingested_at,
    sourceUrl: r.source_url,
    parseStatus: r.parse_status,
    parserVersion: r.parser_version,
    origin: r.origin,
    items: (r.items ?? '').split(',').filter(Boolean),
    freshness: r.base_form === '13F-HR'
      ? classifyFreshness({ kind: 'holdings', origin: r.origin, acceptedAt: r.accepted_at, periodOfReport: r.period_of_report, now })
      : classifyFreshness({ kind: 'filing', origin: r.origin, acceptedAt: r.accepted_at, now }),
  };
}

export function getFiling(db: DB, accession: string, now: string): FilingRef | null {
  const r = one<FilingDbRow>(db, `${FILING_SELECT} WHERE f.accession = ?`, accession);
  return r ? toFilingRef(r, now) : null;
}

export function listFilings(db: DB, opts: {
  asOf: string; now: string; since?: string; forms?: string[]; cik?: string; limit?: number; offset?: number;
}): FilingRef[] {
  const where = ['f.accepted_at <= ?'];
  const params: unknown[] = [opts.asOf];
  if (opts.since) { where.push('f.accepted_at > ?'); params.push(opts.since); }
  if (opts.forms?.length) { where.push(`f.base_form IN (${opts.forms.map(() => '?').join(',')})`); params.push(...opts.forms); }
  if (opts.cik) { where.push('(f.filer_cik = ? OR f.subject_cik = ?)'); params.push(opts.cik, opts.cik); }
  params.push(opts.limit ?? 50, opts.offset ?? 0);
  return all<FilingDbRow>(db, `${FILING_SELECT} WHERE ${where.join(' AND ')} ORDER BY f.accepted_at DESC LIMIT ? OFFSET ?`, ...params).map((r) => toFilingRef(r, opts.now));
}

// ---------------------------------------------------------------------------
// Insider transactions (Form 4), amendment-aware and date-safe
// ---------------------------------------------------------------------------

interface Form4Filing { accession: string; subject_cik: string; filer_cik: string; period_of_report: string | null; is_amendment: number; accepted_at: string }

/**
 * Pick the Form 4 accessions whose transactions should be used as of `asOf`.
 * For each (issuer, reporting owner, period) the latest 4/A accepted by the cutoff
 * replaces earlier filings for that period; otherwise all originals are used.
 */
export function effectiveForm4Accessions(filings: Form4Filing[]): Set<string> {
  const groups = new Map<string, Form4Filing[]>();
  for (const f of filings) {
    const k = `${f.subject_cik}|${f.filer_cik}|${f.period_of_report ?? f.accession}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(f);
  }
  const keep = new Set<string>();
  for (const g of groups.values()) {
    const amendments = g.filter((f) => f.is_amendment).sort((a, b) => b.accepted_at.localeCompare(a.accepted_at));
    if (amendments.length) keep.add(amendments[0].accession);
    else g.forEach((f) => keep.add(f.accession));
  }
  return keep;
}

interface TxnRow {
  id: number; accession: string; issuer_cik: string; owner_cik: string; owner_name: string; owner_role: string; security_title: string;
  is_derivative: number; transaction_date: string; code: string; acquired_disposed: 'A' | 'D'; shares: number; price: number | null;
  shares_owned_after: number | null; direct_indirect: 'D' | 'I'; is_10b5_1: number; accepted_at: string; filing_date: string;
  source_url: string | null; origin: DataOrigin; ticker: string | null; issuer_name: string | null;
}

export function listInsiderTransactions(db: DB, opts: { asOf: string; issuerCik?: string; sinceDays?: number; ownerCik?: string }): InsiderTransaction[] {
  const where = [`f.base_form = '4'`, 'f.accepted_at <= ?', `f.parse_status IN ('parsed','partial')`];
  const params: unknown[] = [opts.asOf];
  if (opts.issuerCik) { where.push('f.subject_cik = ?'); params.push(opts.issuerCik); }
  if (opts.ownerCik) { where.push('f.filer_cik = ?'); params.push(opts.ownerCik); }
  const filings = all<Form4Filing>(db, `SELECT accession, subject_cik, filer_cik, period_of_report, is_amendment, accepted_at FROM filings f WHERE ${where.join(' AND ')}`, ...params);
  const keep = effectiveForm4Accessions(filings);
  if (!keep.size) return [];
  const accs = [...keep];
  const rows = all<TxnRow>(
    db,
    `SELECT t.*, f.accepted_at, f.filing_date, f.source_url, f.origin, e.ticker, e.name AS issuer_name
     FROM insider_transactions t JOIN filings f ON f.accession = t.accession LEFT JOIN entities e ON e.cik = t.issuer_cik
     WHERE t.accession IN (${accs.map(() => '?').join(',')}) ORDER BY t.transaction_date DESC, f.accepted_at DESC, t.row_index`,
    ...accs,
  );
  const since = opts.sinceDays != null ? addDays(opts.asOf, -opts.sinceDays).slice(0, 10) : null;
  const seen = new Set<string>();
  const out: InsiderTransaction[] = [];
  for (const r of rows) {
    if (since && r.transaction_date < since) continue;
    // Duplicate submissions of the same transaction must not be counted twice.
    const key = [r.issuer_cik, r.owner_cik, r.transaction_date, r.code, r.shares, r.price, r.is_derivative, r.acquired_disposed].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const c = classifyForm4(r.code, !!r.is_derivative);
    out.push({
      id: r.id,
      accession: r.accession,
      issuerCik: r.issuer_cik,
      ticker: r.ticker,
      issuerName: r.issuer_name ?? r.issuer_cik,
      ownerCik: r.owner_cik,
      ownerName: r.owner_name,
      ownerRole: r.owner_role,
      securityTitle: r.security_title,
      isDerivative: !!r.is_derivative,
      transactionDate: r.transaction_date,
      code: r.code,
      codeLabel: c.codeLabel,
      classification: c.cls,
      classificationLabel: c.label,
      acquiredDisposed: r.acquired_disposed,
      shares: r.shares,
      price: r.price,
      value: r.price != null ? r.price * r.shares : null,
      sharesOwnedAfter: r.shares_owned_after,
      directOrIndirect: r.direct_indirect,
      is10b51: !!r.is_10b5_1,
      acceptedAt: r.accepted_at,
      filingDate: r.filing_date,
      sourceUrl: r.source_url,
      origin: r.origin,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Corporate events (8-K) and ownership disclosures (13D / 13G)
// ---------------------------------------------------------------------------

interface EventRow {
  accession: string; subject_cik: string; filer_cik: string; form_type: string; base_form: string; is_amendment: number; event_date: string | null;
  period_of_report: string | null; accepted_at: string; items: string | null; source_url: string | null; origin: DataOrigin; ticker: string | null;
  issuer_name: string | null; filer_name: string | null; percent_of_class: number | null; purpose_excerpt: string | null;
}

export function listEvents(db: DB, opts: { asOf: string; issuerCik?: string; sinceDays?: number; forms?: ('8-K' | 'SC 13D' | 'SC 13G')[] }): CorporateEvent[] {
  const forms = opts.forms ?? ['8-K', 'SC 13D', 'SC 13G'];
  const where = [`f.base_form IN (${forms.map(() => '?').join(',')})`, 'f.accepted_at <= ?'];
  const params: unknown[] = [...forms, opts.asOf];
  if (opts.issuerCik) { where.push('f.subject_cik = ?'); params.push(opts.issuerCik); }
  if (opts.sinceDays != null) { where.push('f.accepted_at >= ?'); params.push(addDays(opts.asOf, -opts.sinceDays)); }
  const rows = all<EventRow>(
    db,
    `SELECT f.*, e.ticker, e.name AS issuer_name, fe.name AS filer_name, o.percent_of_class, o.purpose_excerpt
     FROM filings f LEFT JOIN entities e ON e.cik = f.subject_cik LEFT JOIN entities fe ON fe.cik = f.filer_cik
     LEFT JOIN ownership_disclosures o ON o.accession = f.accession
     WHERE ${where.join(' AND ')} ORDER BY f.accepted_at DESC`,
    ...params,
  );
  return rows.map((r) => {
    const items = (r.items ?? '').split(',').filter(Boolean);
    const isActivist = r.base_form === 'SC 13D';
    const category: CorporateEvent['category'] = r.base_form === '8-K' ? 'corporate_event' : isActivist ? 'activist' : 'passive_ownership';
    const pct = r.percent_of_class != null ? ` (${r.percent_of_class.toFixed(1)}% of class)` : '';
    const headline = r.base_form === '8-K'
      ? headlineFor8K(items)
      : `${r.filer_name ?? 'A filer'} ${r.is_amendment ? 'amended its' : 'filed a'} Schedule ${isActivist ? '13D (active intent possible)' : '13G (passive)'}${pct}`;
    return {
      accession: r.accession,
      issuerCik: r.subject_cik,
      ticker: r.ticker,
      issuerName: r.issuer_name ?? r.subject_cik,
      formType: r.form_type,
      eventDate: r.event_date ?? r.period_of_report,
      acceptedAt: r.accepted_at,
      items: describeItems(items),
      headline,
      category,
      percentOfClass: r.percent_of_class,
      filerName: r.filer_name,
      isAmendment: !!r.is_amendment,
      sourceUrl: r.source_url,
      origin: r.origin,
    };
  });
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export function search(db: DB, q: string, limit = 12): { kind: 'stock' | 'manager'; id: string; label: string; sublabel: string; origin: DataOrigin }[] {
  const term = q.trim();
  if (!term) return [];
  const like = `%${term.replace(/[%_]/g, '')}%`;
  const rows = all<EntityRow>(
    db,
    `SELECT * FROM entities WHERE kind IN ('issuer','manager') AND (name LIKE ? OR ticker LIKE ? OR cik LIKE ?)
     ORDER BY CASE WHEN UPPER(ticker) = UPPER(?) THEN 0 WHEN name LIKE ? THEN 1 ELSE 2 END, tracked DESC, name LIMIT ?`,
    like, like, `%${term}%`, term, `${term}%`, limit,
  );
  return rows.map((r) => ({
    kind: r.kind === 'manager' ? 'manager' : 'stock',
    id: r.kind === 'manager' ? r.cik : (r.ticker ?? r.cik),
    label: r.kind === 'manager' ? r.name : `${r.ticker ?? ''} · ${r.name}`.replace(/^ · /, ''),
    sublabel: r.kind === 'manager' ? `Investment manager · CIK ${r.cik}` : `${r.sector ?? 'Sector n/a'} · CIK ${r.cik}`,
    origin: r.origin,
  }));
}

/** Transactions reported in one Form 4, plus whether a later 4/A (accepted by `asOf`) supersedes it. */
export function form4Detail(db: DB, accession: string, asOf: string): { transactions: InsiderTransaction[]; supersededBy: string | null } {
  const f = one<Form4Filing>(db, `SELECT accession, subject_cik, filer_cik, period_of_report, is_amendment, accepted_at FROM filings WHERE accession = ?`, accession);
  if (!f) return { transactions: [], supersededBy: null };
  const group = all<Form4Filing>(db, `SELECT accession, subject_cik, filer_cik, period_of_report, is_amendment, accepted_at FROM filings
     WHERE base_form = '4' AND subject_cik = ? AND filer_cik = ? AND COALESCE(period_of_report, accession) = COALESCE(?, ?) AND accepted_at <= ?`,
    f.subject_cik, f.filer_cik, f.period_of_report, f.accession, asOf);
  const keep = effectiveForm4Accessions(group);
  const rows = all<TxnRow>(db, `SELECT t.*, f.accepted_at, f.filing_date, f.source_url, f.origin, e.ticker, e.name AS issuer_name
     FROM insider_transactions t JOIN filings f ON f.accession = t.accession LEFT JOIN entities e ON e.cik = t.issuer_cik WHERE t.accession = ? ORDER BY t.row_index`, accession);
  const transactions = rows.map((r) => {
    const c = classifyForm4(r.code, !!r.is_derivative);
    return {
      id: r.id, accession: r.accession, issuerCik: r.issuer_cik, ticker: r.ticker, issuerName: r.issuer_name ?? r.issuer_cik, ownerCik: r.owner_cik, ownerName: r.owner_name,
      ownerRole: r.owner_role, securityTitle: r.security_title, isDerivative: !!r.is_derivative, transactionDate: r.transaction_date, code: r.code, codeLabel: c.codeLabel,
      classification: c.cls, classificationLabel: c.label, acquiredDisposed: r.acquired_disposed, shares: r.shares, price: r.price, value: r.price != null ? r.price * r.shares : null,
      sharesOwnedAfter: r.shares_owned_after, directOrIndirect: r.direct_indirect, is10b51: !!r.is_10b5_1, acceptedAt: r.accepted_at, filingDate: r.filing_date, sourceUrl: r.source_url, origin: r.origin,
    } satisfies InsiderTransaction;
  });
  const supersededBy = keep.has(accession) ? null : [...keep][0] ?? null;
  return { transactions, supersededBy };
}
