import { createHash } from 'node:crypto';
import { type DB, one, tx } from '../db/index.ts';
import type { DataOrigin } from '../../shared/types.ts';
import type { Parsed13FRow } from './parse13f.ts';
import type { ParsedForm4 } from './parseForm4.ts';

export const hashContent = (s: string) => createHash('sha256').update(s).digest('hex');

export interface FilingHeader {
  accession: string;
  filerCik: string;
  subjectCik: string | null;
  formType: string;
  baseForm: string;
  isAmendment: boolean;
  amendmentType?: string | null;
  amendsAccession?: string | null;
  periodOfReport: string | null;
  filingDate: string;
  acceptedAt: string;
  eventDate?: string | null;
  items?: string[];
  primaryDocument?: string | null;
  sourceUrl: string | null;
  indexUrl?: string | null;
  parserVersion: string;
  origin: DataOrigin;
}

export type StoreOutcome = 'new' | 'unchanged' | 'reparsed';

export function upsertEntity(db: DB, e: {
  cik: string; name: string; kind: 'manager' | 'issuer' | 'person' | 'filer'; tracked?: boolean; ticker?: string | null;
  sector?: string | null; marketCap?: number | null; marketCapAsOf?: string | null; description?: string | null; origin: DataOrigin; now: string;
}): void {
  db.prepare(`INSERT INTO entities (cik, name, kind, tracked, ticker, sector, market_cap, market_cap_as_of, description, origin, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cik) DO UPDATE SET
      name = excluded.name,
      kind = CASE WHEN entities.kind IN ('manager','issuer') THEN entities.kind ELSE excluded.kind END,
      tracked = MAX(entities.tracked, excluded.tracked),
      ticker = COALESCE(excluded.ticker, entities.ticker),
      sector = COALESCE(excluded.sector, entities.sector),
      market_cap = COALESCE(excluded.market_cap, entities.market_cap),
      market_cap_as_of = COALESCE(excluded.market_cap_as_of, entities.market_cap_as_of),
      description = COALESCE(excluded.description, entities.description),
      updated_at = excluded.updated_at`).run(
    e.cik, e.name, e.kind, e.tracked ? 1 : 0, e.ticker ?? null, e.sector ?? null, e.marketCap ?? null, e.marketCapAsOf ?? null,
    e.description ?? null, e.origin, e.now,
  );
}

export function upsertSecurity(db: DB, s: { cusip: string; issuerCik: string | null; ticker: string | null; name: string; titleOfClass?: string | null; mappingSource: string; origin: DataOrigin }): void {
  db.prepare(`INSERT INTO securities (cusip, issuer_cik, ticker, name, title_of_class, mapping_source, origin) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cusip) DO UPDATE SET
      issuer_cik = COALESCE(securities.issuer_cik, excluded.issuer_cik),
      ticker = COALESCE(excluded.ticker, securities.ticker),
      mapping_source = CASE WHEN securities.mapping_source = 'universe' THEN securities.mapping_source ELSE excluded.mapping_source END`)
    .run(s.cusip, s.issuerCik, s.ticker, s.name, s.titleOfClass ?? null, s.mappingSource, s.origin);
}

/**
 * Insert a filing header and its parsed rows idempotently.
 * - Same accession + same content hash + same parser version → no-op.
 * - Changed content or parser version → rows replaced inside a transaction and
 *   the correction is recorded in parse_runs (with the number of superseded rows).
 * Amendments are distinct accessions and therefore never overwrite originals.
 */
export function storeFiling(
  db: DB,
  h: FilingHeader,
  content: string,
  writeRows: () => { rows: number; status: 'parsed' | 'partial' | 'header_only'; message?: string },
  rowTables: string[],
  now: string,
): StoreOutcome {
  const hash = hashContent(content);
  const existing = one<{ content_hash: string | null; parser_version: string; parse_status: string }>(
    db, 'SELECT content_hash, parser_version, parse_status FROM filings WHERE accession = ?', h.accession,
  );
  if (existing && existing.content_hash === hash && existing.parser_version === h.parserVersion && existing.parse_status !== 'failed') {
    return 'unchanged';
  }
  return tx(db, () => {
    let superseded = 0;
    if (existing) {
      for (const t of rowTables) {
        const r = db.prepare(`DELETE FROM ${t} WHERE accession = ?`).run(h.accession);
        superseded += Number(r.changes);
      }
      db.prepare(`UPDATE filings SET parser_version = ?, content_hash = ?, parse_status = 'pending', parse_error = NULL WHERE accession = ?`)
        .run(h.parserVersion, hash, h.accession);
    } else {
      db.prepare(`INSERT INTO filings (accession, filer_cik, subject_cik, form_type, base_form, is_amendment, amendment_type, amends_accession,
          period_of_report, filing_date, accepted_at, event_date, items, primary_document, source_url, index_url, ingested_at, parse_status,
          parser_version, content_hash, origin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).run(
        h.accession, h.filerCik, h.subjectCik, h.formType, h.baseForm, h.isAmendment ? 1 : 0, h.amendmentType ?? null, h.amendsAccession ?? null,
        h.periodOfReport, h.filingDate, h.acceptedAt, h.eventDate ?? null, (h.items ?? []).join(','), h.primaryDocument ?? null,
        h.sourceUrl, h.indexUrl ?? null, now, h.parserVersion, hash, h.origin,
      );
    }
    try {
      const res = writeRows();
      db.prepare('UPDATE filings SET parse_status = ?, parse_error = ? WHERE accession = ?').run(res.status, res.message ?? null, h.accession);
      db.prepare(`INSERT INTO parse_runs (accession, parser_version, content_hash, status, row_count, message, ran_at, superseded_rows) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(h.accession, h.parserVersion, hash, res.status, res.rows, res.message ?? null, now, superseded);
    } catch (err) {
      db.prepare(`UPDATE filings SET parse_status = 'failed', parse_error = ? WHERE accession = ?`).run((err as Error).message, h.accession);
      db.prepare(`INSERT INTO parse_runs (accession, parser_version, content_hash, status, row_count, message, ran_at, superseded_rows) VALUES (?, ?, ?, 'failed', 0, ?, ?, ?)`)
        .run(h.accession, h.parserVersion, hash, (err as Error).message, now, superseded);
    }
    return existing ? 'reparsed' : 'new';
  });
}

export function write13FRows(db: DB, accession: string, managerCik: string, period: string, rows: Parsed13FRow[]): number {
  const stmt = db.prepare(`INSERT INTO holdings_13f (accession, row_index, manager_cik, period, cusip, name_of_issuer, title_of_class, value_usd, shares,
      sh_prn_type, put_call, investment_discretion, voting_sole, voting_shared, voting_none) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const r of rows) {
    stmt.run(accession, r.rowIndex, managerCik, period, r.cusip, r.nameOfIssuer, r.titleOfClass, r.valueUsd, r.shares, r.shPrnType, r.putCall,
      r.investmentDiscretion, r.votingSole, r.votingShared, r.votingNone);
  }
  return rows.length;
}

export function writeForm4Rows(db: DB, accession: string, f: ParsedForm4): number {
  const owner = f.owners[0] ?? { cik: '0000000000', name: 'Unknown', role: 'Reporting person' };
  const ownerName = f.owners.length > 1 ? `${owner.name} (+${f.owners.length - 1} joint filer${f.owners.length > 2 ? 's' : ''})` : owner.name;
  const stmt = db.prepare(`INSERT INTO insider_transactions (accession, row_index, issuer_cik, owner_cik, owner_name, owner_role, security_title, is_derivative,
      transaction_date, code, acquired_disposed, shares, price, shares_owned_after, direct_indirect, is_10b5_1, footnotes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const t of f.transactions) {
    stmt.run(accession, t.rowIndex, f.issuerCik, owner.cik, ownerName, owner.role, t.securityTitle, t.isDerivative ? 1 : 0, t.transactionDate, t.code,
      t.acquiredDisposed, t.shares, t.price, t.sharesOwnedAfter, t.directOrIndirect, f.is10b51 ? 1 : 0, t.footnotes.length ? JSON.stringify(t.footnotes) : null);
  }
  return f.transactions.length;
}

export function writeOwnershipDisclosure(db: DB, d: {
  accession: string; issuerCik: string; filerCik: string; schedule: '13D' | '13G'; percentOfClass: number | null; shares: number | null;
  eventDate: string | null; purposeExcerpt: string | null;
}): number {
  db.prepare(`INSERT INTO ownership_disclosures (accession, issuer_cik, filer_cik, schedule, percent_of_class, shares, event_date, purpose_excerpt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(d.accession, d.issuerCik, d.filerCik, d.schedule, d.percentOfClass, d.shares, d.eventDate, d.purposeExcerpt);
  return 1;
}
