import { parseXml, findKey, text } from './xml.ts';
import { padCik } from './ids.ts';

export const PARSER_SCHEDULE13_VERSION = 'sched13@1.0.0';

export interface ParsedSchedule13 {
  issuerCik: string | null;
  percentOfClass: number | null;
  shares: number | null;
  eventDate: string | null;
  purposeExcerpt: string | null;
  status: 'parsed' | 'partial';
}

const toNum = (v: unknown): number | null => {
  const s = typeof v === 'object' && v ? text(v, '#text') : v == null ? null : String(v);
  if (s == null) return null;
  const n = Number(String(s).replace(/[,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/**
 * Structured Schedule 13D/13G XML (required by the SEC from Dec 2024).
 * The parser is deliberately tolerant: it locates fields by name pattern so
 * schema revisions degrade to a "partial" parse instead of failing outright.
 * Older filings (HTML/text only) are stored as header-only records.
 */
export function parseSchedule13Xml(xml: string): ParsedSchedule13 {
  const doc = parseXml(xml);
  const issuerCik = findKey(doc, (k) => /^issuerCik$/i.test(k));
  const pct = findKey(doc, (k) => /percent.*class|classPercent/i.test(k));
  const shares = findKey(doc, (k) => /aggregateAmount|amountBeneficiallyOwned/i.test(k));
  const eventDate = findKey(doc, (k) => /dateOfEvent|eventDate/i.test(k));
  const purpose = findKey(doc, (k) => /purposeOfTransaction/i.test(k));
  const pctNum = toNum(pct);
  const out: ParsedSchedule13 = {
    issuerCik: issuerCik != null ? padCik(String(issuerCik)) : null,
    percentOfClass: pctNum,
    shares: toNum(shares),
    eventDate: typeof eventDate === 'string' ? normalizeDate(eventDate) : null,
    purposeExcerpt: typeof purpose === 'string' ? purpose.slice(0, 400) : null,
    status: pctNum != null ? 'parsed' : 'partial',
  };
  return out;
}

function normalizeDate(s: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return iso[0];
  const mdy = /^(\d{2})[/-](\d{2})[/-](\d{4})$/.exec(s);
  if (mdy) return `${mdy[3]}-${mdy[1]}-${mdy[2]}`;
  return null;
}
