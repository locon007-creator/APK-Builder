import { openDb, type DB } from '../server/db/index.ts';
import { storeFiling, upsertEntity, upsertSecurity, write13FRows, writeForm4Rows } from '../server/sec/store.ts';
import { parse13FInformationTable, PARSER_13F_VERSION } from '../server/sec/parse13f.ts';
import { parseForm4, PARSER_FORM4_VERSION } from '../server/sec/parseForm4.ts';
import { form4Xml, infoTableXml, type Form4Txn } from '../server/demo/xmlgen.ts';
import { clear13FCache } from '../server/domain/thirteenF.ts';

export const NOW = '2026-03-01T12:00:00.000Z';
export const M1 = '0000000101';
export const M2 = '0000000102';
export const ISSUER = '0000000201';
export const CUSIP = '000000201';

export function freshDb(): DB {
  const db = openDb(':memory:');
  upsertEntity(db, { cik: M1, name: 'Alpha Mgmt', kind: 'manager', tracked: true, origin: 'sec', now: NOW });
  upsertEntity(db, { cik: M2, name: 'Beta Mgmt', kind: 'manager', tracked: true, origin: 'sec', now: NOW });
  upsertEntity(db, { cik: ISSUER, name: 'Target Co', kind: 'issuer', tracked: true, ticker: 'TGT1', sector: 'Industrials', origin: 'sec', now: NOW });
  upsertSecurity(db, { cusip: CUSIP, issuerCik: ISSUER, ticker: 'TGT1', name: 'TARGET CO', mappingSource: 'universe', origin: 'sec' });
  return db;
}

let seq = 0;
export function file13F(db: DB, o: { manager: string; period: string; acceptedAt: string; rows: { cusip: string; shares: number; value: number; name?: string; putCall?: 'Put' | 'Call' }[]; amendmentType?: 'RESTATEMENT' | 'NEW HOLDINGS'; accession?: string }) {
  const accession = o.accession ?? `00000001${String(o.manager).slice(-2)}-26-${String(++seq).padStart(6, '0')}`;
  const xml = infoTableXml(o.rows.map((r) => ({ name: r.name ?? 'TARGET CO', cusip: r.cusip, shares: r.shares, value: r.value, putCall: r.putCall })));
  const filingDate = o.acceptedAt.slice(0, 10);
  const t = parse13FInformationTable(xml, filingDate);
  const out = storeFiling(db, {
    accession, filerCik: o.manager, subjectCik: null, formType: o.amendmentType ? '13F-HR/A' : '13F-HR', baseForm: '13F-HR', isAmendment: !!o.amendmentType,
    amendmentType: o.amendmentType ?? null, periodOfReport: o.period, filingDate, acceptedAt: o.acceptedAt, sourceUrl: null, parserVersion: PARSER_13F_VERSION, origin: 'sec',
  }, xml, () => ({ rows: write13FRows(db, accession, o.manager, o.period, t.rows), status: 'parsed' }), ['holdings_13f'], NOW);
  clear13FCache(db);
  return { accession, outcome: out };
}

export function file4(db: DB, o: { owner: string; ownerName?: string; acceptedAt: string; txns: Form4Txn[]; amendment?: boolean; tenB51?: boolean; accession?: string; period?: string }) {
  const accession = o.accession ?? `00000003${o.owner.slice(-2)}-26-${String(++seq).padStart(6, '0')}`;
  const period = o.period ?? o.txns.map((t) => t.date).sort().at(-1)!;
  const xml = form4Xml({ issuerCik: ISSUER, issuerName: 'Target Co', ticker: 'TGT1', ownerCik: o.owner, ownerName: o.ownerName ?? `Owner ${o.owner}`, role: { director: true }, period, txns: o.txns, amendment: o.amendment, tenB51: o.tenB51 });
  const f = parseForm4(xml);
  return storeFiling(db, {
    accession, filerCik: o.owner, subjectCik: ISSUER, formType: o.amendment ? '4/A' : '4', baseForm: '4', isAmendment: !!o.amendment, periodOfReport: period,
    filingDate: o.acceptedAt.slice(0, 10), acceptedAt: o.acceptedAt, sourceUrl: null, parserVersion: PARSER_FORM4_VERSION, origin: 'sec',
  }, xml, () => ({ rows: writeForm4Rows(db, accession, f), status: 'parsed' }), ['insider_transactions'], NOW);
}

export function file8K(db: DB, o: { items: string[]; acceptedAt: string; eventDate: string; amendment?: boolean }) {
  const accession = `0000000201-26-${String(++seq).padStart(6, '0')}`;
  storeFiling(db, {
    accession, filerCik: ISSUER, subjectCik: ISSUER, formType: o.amendment ? '8-K/A' : '8-K', baseForm: '8-K', isAmendment: !!o.amendment, periodOfReport: o.eventDate, eventDate: o.eventDate,
    filingDate: o.acceptedAt.slice(0, 10), acceptedAt: o.acceptedAt, items: o.items, sourceUrl: 'https://www.sec.gov/x', parserVersion: 'header@1.0.0', origin: 'sec',
  }, accession, () => ({ rows: 0, status: 'header_only' }), [], NOW);
  return accession;
}
