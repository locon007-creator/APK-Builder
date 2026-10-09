import { baseForm, normalizeAccession, padCik } from './ids.ts';

// Shape of https://data.sec.gov/submissions/CIK##########.json (subset).
export interface SubmissionsJson {
  cik: string;
  name: string;
  tickers?: string[];
  sicDescription?: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      acceptanceDateTime: string[];
      form: string[];
      primaryDocument: string[];
      items?: string[];
    };
  };
}

export interface SubmissionEntry {
  accession: string;
  form: string;
  baseForm: string;
  isAmendment: boolean;
  filingDate: string;
  reportDate: string | null;
  acceptedAt: string;
  primaryDocument: string;
  items: string[];
}

/**
 * EDGAR's acceptanceDateTime is an Eastern-time wall clock rendered with a "Z"
 * suffix (e.g. "2025-02-14T16:05:12.000Z" means 4:05pm ET). Convert to true UTC.
 */
export function acceptanceToUtc(raw: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) throw new Error(`Unrecognised acceptanceDateTime: ${raw}`);
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // Determine the New York offset at that instant.
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' });
  const guess = new Date(asIfUtc + 5 * 3600_000);
  const tz = fmt.formatToParts(guess).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT-5';
  const off = /GMT([+-]\d+)/.exec(tz);
  const offsetHours = off ? Number(off[1]) : -5;
  return new Date(asIfUtc - offsetHours * 3600_000).toISOString();
}

export function parseSubmissions(json: SubmissionsJson, forms: Set<string>): SubmissionEntry[] {
  const r = json.filings.recent;
  const out: SubmissionEntry[] = [];
  for (let i = 0; i < r.accessionNumber.length; i++) {
    const { base, isAmendment } = baseForm(r.form[i]);
    if (!forms.has(base)) continue;
    out.push({
      accession: normalizeAccession(r.accessionNumber[i]),
      form: r.form[i],
      baseForm: base,
      isAmendment,
      filingDate: r.filingDate[i],
      reportDate: r.reportDate[i] || null,
      acceptedAt: acceptanceToUtc(r.acceptanceDateTime[i]),
      primaryDocument: r.primaryDocument[i],
      items: (r.items?.[i] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    });
  }
  return out;
}

export function submissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${padCik(cik)}.json`;
}

/** Form 4 primary documents are listed with their XSL rendering prefix (xslF345X05/…); the raw XML lives at the bare filename. */
export function rawForm4Document(primaryDocument: string): string {
  return primaryDocument.replace(/^xsl[^/]+\//i, '');
}
