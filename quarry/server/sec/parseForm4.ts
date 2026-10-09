import { parseXml, child, text, num, bool, asArray } from './xml.ts';
import { padCik } from './ids.ts';

export const PARSER_FORM4_VERSION = 'form4@1.1.0';

export interface ParsedForm4Txn {
  rowIndex: number;
  securityTitle: string;
  isDerivative: boolean;
  transactionDate: string;
  code: string;
  acquiredDisposed: 'A' | 'D';
  shares: number;
  price: number | null;
  sharesOwnedAfter: number | null;
  directOrIndirect: 'D' | 'I';
  footnotes: string[];
}

export interface ParsedForm4 {
  documentType: string;
  periodOfReport: string | null;
  issuerCik: string;
  issuerName: string;
  issuerTicker: string | null;
  owners: { cik: string; name: string; role: string }[];
  is10b51: boolean;
  transactions: ParsedForm4Txn[];
  warnings: string[];
}

function ownerRole(rel: unknown): string {
  const roles: string[] = [];
  if (bool(rel, 'isDirector')) roles.push('Director');
  if (bool(rel, 'isOfficer')) roles.push(text(rel, 'officerTitle') ?? 'Officer');
  if (bool(rel, 'isTenPercentOwner')) roles.push('10% owner');
  if (bool(rel, 'isOther')) roles.push(text(rel, 'otherText') ?? 'Other');
  return roles.join(', ') || 'Reporting person';
}

function footnoteIds(node: unknown): string[] {
  const ids: string[] = [];
  const walk = (n: unknown) => {
    if (n == null || typeof n !== 'object') return;
    for (const [k, v] of Object.entries(n as Record<string, unknown>)) {
      if (k === 'footnoteId') asArray(v as unknown[]).forEach(() => ids.push('fn'));
      else walk(v);
    }
  };
  walk(node);
  return ids;
}

export function parseForm4(xml: string): ParsedForm4 {
  const doc = parseXml(xml);
  const od = child(doc, 'ownershipDocument');
  if (od == null) throw new Error('Not a Form 4 ownership document: <ownershipDocument> missing');
  const warnings: string[] = [];
  const issuerCikRaw = text(od, 'issuer', 'issuerCik');
  if (!issuerCikRaw) throw new Error('Form 4 missing issuerCik');

  const owners = asArray(child(od, 'reportingOwner') as unknown[]).map((o) => ({
    cik: padCik(text(o, 'reportingOwnerId', 'rptOwnerCik') ?? '0'),
    name: text(o, 'reportingOwnerId', 'rptOwnerName') ?? 'Unknown reporting person',
    role: ownerRole(child(o, 'reportingOwnerRelationship')),
  }));
  if (!owners.length) warnings.push('No reporting owner listed');

  const transactions: ParsedForm4Txn[] = [];
  const pushTxn = (t: unknown, isDerivative: boolean) => {
    const code = text(t, 'transactionCoding', 'transactionCode');
    const date = text(t, 'transactionDate', 'value') ?? text(t, 'transactionDate');
    const shares = num(t, 'transactionAmounts', 'transactionShares', 'value') ?? num(t, 'transactionAmounts', 'transactionShares');
    const ad = (text(t, 'transactionAmounts', 'transactionAcquiredDisposedCode', 'value') ?? text(t, 'transactionAmounts', 'transactionAcquiredDisposedCode'))?.toUpperCase();
    if (!code || !date || shares == null || (ad !== 'A' && ad !== 'D')) {
      warnings.push(`${isDerivative ? 'Derivative' : 'Non-derivative'} row ${transactions.length + 1}: incomplete transaction — skipped`);
      return;
    }
    const price = num(t, 'transactionAmounts', 'transactionPricePerShare', 'value') ?? num(t, 'transactionAmounts', 'transactionPricePerShare');
    const doi = (text(t, 'ownershipNature', 'directOrIndirectOwnership', 'value') ?? text(t, 'ownershipNature', 'directOrIndirectOwnership') ?? 'D').toUpperCase();
    transactions.push({
      rowIndex: transactions.length,
      securityTitle: text(t, 'securityTitle', 'value') ?? text(t, 'securityTitle') ?? 'Unknown security',
      isDerivative,
      transactionDate: date.slice(0, 10),
      code: code.toUpperCase(),
      acquiredDisposed: ad,
      shares,
      price: price != null && price > 0 ? price : null,
      sharesOwnedAfter: num(t, 'postTransactionAmounts', 'sharesOwnedFollowingTransaction', 'value') ?? num(t, 'postTransactionAmounts', 'sharesOwnedFollowingTransaction'),
      directOrIndirect: doi === 'I' ? 'I' : 'D',
      footnotes: footnoteIds(t),
    });
  };
  asArray(child(od, 'nonDerivativeTable', 'nonDerivativeTransaction') as unknown[]).forEach((t) => pushTxn(t, false));
  asArray(child(od, 'derivativeTable', 'derivativeTransaction') as unknown[]).forEach((t) => pushTxn(t, true));

  return {
    documentType: text(od, 'documentType') ?? '4',
    periodOfReport: text(od, 'periodOfReport'),
    issuerCik: padCik(issuerCikRaw),
    issuerName: text(od, 'issuer', 'issuerName') ?? 'Unknown issuer',
    issuerTicker: text(od, 'issuer', 'issuerTradingSymbol')?.toUpperCase() ?? null,
    owners,
    // Checkbox added to Forms 4/5 in 2023 indicating a Rule 10b5-1(c) plan.
    is10b51: bool(od, 'aff10b5One'),
    transactions,
    warnings,
  };
}
