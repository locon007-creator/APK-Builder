// Identifier helpers for SEC EDGAR.

export function padCik(cik: string | number): string {
  const digits = String(cik).replace(/\D/g, '');
  if (!digits) throw new Error(`Invalid CIK: ${cik}`);
  return digits.padStart(10, '0');
}

export function unpadCik(cik: string): string {
  return String(Number(cik));
}

const ACCESSION_RE = /^(\d{10})-?(\d{2})-?(\d{6})$/;

export function normalizeAccession(acc: string): string {
  const m = ACCESSION_RE.exec(acc.trim());
  if (!m) throw new Error(`Invalid accession number: ${acc}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

export function accessionNoDashes(acc: string): string {
  return normalizeAccession(acc).replace(/-/g, '');
}

export function filingIndexUrl(cik: string, accession: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${unpadCik(cik)}/${accessionNoDashes(accession)}/`;
}

export function filingDocumentUrl(cik: string, accession: string, document: string): string {
  return `${filingIndexUrl(cik, accession)}${document}`;
}

/** Normalise an EDGAR form type to the family used for analysis. */
export function baseForm(formType: string): { base: string; isAmendment: boolean } {
  const f = formType.trim().toUpperCase();
  const isAmendment = f.endsWith('/A');
  const core = isAmendment ? f.slice(0, -2) : f;
  if (core === '13F-HR' || core === '13F-NT') return { base: core, isAmendment };
  if (core === '4') return { base: '4', isAmendment };
  if (core === '8-K') return { base: '8-K', isAmendment };
  if (core === 'SC 13D' || core === 'SCHEDULE 13D') return { base: 'SC 13D', isAmendment };
  if (core === 'SC 13G' || core === 'SCHEDULE 13G') return { base: 'SC 13G', isAmendment };
  return { base: core, isAmendment };
}

/** CUSIPs are 9 characters; normalise case and stray whitespace. */
export function normalizeCusip(cusip: string): string {
  return cusip.replace(/\s+/g, '').toUpperCase();
}
