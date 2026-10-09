import { parseXml, child, text, num, asArray } from './xml.ts';
import { normalizeCusip } from './ids.ts';

export const PARSER_13F_VERSION = '13f@1.2.0';

/** SEC rule change: 13F information tables filed on/after 2023-01-03 report value in dollars, earlier in thousands. */
export const VALUE_IN_DOLLARS_FROM = '2023-01-03';

export interface Parsed13FRow {
  rowIndex: number;
  nameOfIssuer: string;
  titleOfClass: string | null;
  cusip: string;
  valueUsd: number;
  shares: number;
  shPrnType: 'SH' | 'PRN';
  putCall: 'PUT' | 'CALL' | null;
  investmentDiscretion: string | null;
  votingSole: number | null;
  votingShared: number | null;
  votingNone: number | null;
}

export interface Parsed13FTable {
  rows: Parsed13FRow[];
  warnings: string[];
  valueMultiplier: 1 | 1000;
}

export function valueMultiplierForFilingDate(filingDate: string): 1 | 1000 {
  return filingDate >= VALUE_IN_DOLLARS_FROM ? 1 : 1000;
}

export function parse13FInformationTable(xml: string, filingDate: string): Parsed13FTable {
  const doc = parseXml(xml);
  const table = child(doc, 'informationTable');
  if (table == null) throw new Error('Not a 13F information table: <informationTable> missing');
  const multiplier = valueMultiplierForFilingDate(filingDate);
  const warnings: string[] = [];
  const rows: Parsed13FRow[] = [];
  asArray(child(table, 'infoTable') as unknown[]).forEach((entry, i) => {
    const cusipRaw = text(entry, 'cusip');
    const name = text(entry, 'nameOfIssuer');
    const value = num(entry, 'value');
    const shares = num(entry, 'shrsOrPrnAmt', 'sshPrnamt');
    const type = (text(entry, 'shrsOrPrnAmt', 'sshPrnamtType') ?? 'SH').toUpperCase();
    if (!cusipRaw || !name || value == null || shares == null) {
      warnings.push(`Row ${i + 1}: missing required field (cusip/name/value/shares) — skipped`);
      return;
    }
    const pc = text(entry, 'putCall')?.toUpperCase() ?? null;
    rows.push({
      rowIndex: i,
      nameOfIssuer: name,
      titleOfClass: text(entry, 'titleOfClass'),
      cusip: normalizeCusip(cusipRaw),
      valueUsd: value * multiplier,
      shares,
      shPrnType: type === 'PRN' ? 'PRN' : 'SH',
      putCall: pc === 'PUT' || pc === 'CALL' ? pc : null,
      investmentDiscretion: text(entry, 'investmentDiscretion'),
      votingSole: num(entry, 'votingAuthority', 'Sole'),
      votingShared: num(entry, 'votingAuthority', 'Shared'),
      votingNone: num(entry, 'votingAuthority', 'None'),
    });
  });
  return { rows, warnings, valueMultiplier: multiplier };
}

export interface Parsed13FCover {
  managerName: string | null;
  periodOfReport: string | null; // YYYY-MM-DD
  isAmendment: boolean;
  amendmentType: 'RESTATEMENT' | 'NEW HOLDINGS' | null;
  tableEntryTotal: number | null;
  tableValueTotal: number | null;
  reportType: string | null;
}

/** "06-30-2025" → "2025-06-30" */
export function edgarDate(s: string | null): string | null {
  if (!s) return null;
  const mdY = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s);
  if (mdY) return `${mdY[3]}-${mdY[1]}-${mdY[2]}`;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

export function parse13FCover(xml: string): Parsed13FCover {
  const doc = parseXml(xml);
  const sub = child(doc, 'edgarSubmission');
  const cover = child(sub, 'formData', 'coverPage');
  const amendType = text(cover, 'amendmentInfo', 'amendmentType')?.toUpperCase() ?? null;
  return {
    managerName: text(cover, 'filingManager', 'name'),
    periodOfReport: edgarDate(text(cover, 'reportCalendarOrQuarter') ?? text(sub, 'headerData', 'filerInfo', 'periodOfReport')),
    isAmendment: /^(true|y)$/i.test(text(cover, 'isAmendment') ?? ''),
    amendmentType: amendType === 'RESTATEMENT' || amendType === 'NEW HOLDINGS' ? amendType : null,
    tableEntryTotal: num(sub, 'formData', 'summaryPage', 'tableEntryTotal'),
    tableValueTotal: num(sub, 'formData', 'summaryPage', 'tableValueTotal'),
    reportType: text(cover, 'reportType'),
  };
}

/** Cross-check the table against the cover page summary. */
export function validate13F(table: Parsed13FTable, cover: Parsed13FCover): string[] {
  const issues: string[] = [];
  if (cover.tableEntryTotal != null && cover.tableEntryTotal !== table.rows.length) {
    issues.push(`Cover reports ${cover.tableEntryTotal} entries; parsed ${table.rows.length}`);
  }
  if (cover.tableValueTotal != null && table.rows.length) {
    const sum = table.rows.reduce((s, r) => s + r.valueUsd, 0);
    const reported = cover.tableValueTotal * table.valueMultiplier;
    if (reported > 0 && Math.abs(sum - reported) / reported > 0.01) {
      issues.push(`Cover value total ${reported.toFixed(0)} differs from parsed total ${sum.toFixed(0)} by >1% (possible unit error by filer)`);
    }
  }
  return issues;
}
