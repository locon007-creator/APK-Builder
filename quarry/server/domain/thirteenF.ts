import { type DB, all } from '../db/index.ts';
import type { DataOrigin, PositionChange, PositionChangeKind } from '../../shared/types.ts';

// ---------------------------------------------------------------------------
// 13F holdings resolution (amendment-aware and look-ahead safe)
// ---------------------------------------------------------------------------

interface FilingRow {
  accession: string;
  form_type: string;
  is_amendment: number;
  amendment_type: string | null;
  accepted_at: string;
  origin: DataOrigin;
}

export interface ResolvedPosition {
  cusip: string;
  name: string;
  shares: number;
  value: number;
  issuerCik: string | null;
  ticker: string | null;
}

export interface Resolved13F {
  managerCik: string;
  period: string;
  /** Accessions combined to build this view, in acceptance order. */
  accessions: string[];
  /** Acceptance time of the latest filing used. */
  acceptedAt: string;
  baseAccession: string;
  amendmentsApplied: { accession: string; type: string; acceptedAt: string }[];
  /** Equity (non-option) share positions keyed by CUSIP. */
  positions: Map<string, ResolvedPosition>;
  /** Option rows (PUT/CALL) are reported separately and excluded from share counts. */
  optionRows: { cusip: string; name: string; putCall: string; shares: number; value: number }[];
  /** Principal-amount (PRN) rows excluded from share counts. */
  principalRows: number;
  totalEquityValue: number;
  origin: DataOrigin;
}

/**
 * Determine which 13F filings make up a manager's reported holdings for a period,
 * using only filings accepted at or before `asOf`:
 *  - the latest RESTATEMENT amendment (if any) replaces everything before it;
 *  - otherwise the original 13F-HR is the base;
 *  - NEW HOLDINGS amendments accepted after the base are added to it.
 */
export function selectFilingsFor13F(filings: FilingRow[]): { base: FilingRow | null; additions: FilingRow[] } {
  const sorted = [...filings].sort((a, b) => a.accepted_at.localeCompare(b.accepted_at));
  let base: FilingRow | null = null;
  for (const f of sorted) {
    if (!f.is_amendment) {
      if (!base) base = f;
    } else if ((f.amendment_type ?? '').toUpperCase() === 'RESTATEMENT') {
      base = f;
    }
  }
  const additions = sorted.filter(
    (f) => f.is_amendment && (f.amendment_type ?? '').toUpperCase() === 'NEW HOLDINGS' && (!base || f.accepted_at >= base.accepted_at),
  );
  return { base, additions };
}

// Per-database memo; cleared whenever new filings are stored.
const caches = new WeakMap<DB, Map<string, Resolved13F | null>>();
export function clear13FCache(db?: DB): void {
  if (db) caches.delete(db);
}

export function resolve13F(db: DB, managerCik: string, period: string, asOf: string): Resolved13F | null {
  let cache = caches.get(db);
  if (!cache) caches.set(db, (cache = new Map()));
  const key = `${managerCik}|${period}|${asOf}`;
  if (cache.has(key)) return cache.get(key)!;
  const filings = all<FilingRow>(
    db,
    `SELECT accession, form_type, is_amendment, amendment_type, accepted_at, origin FROM filings
     WHERE filer_cik = ? AND base_form = '13F-HR' AND period_of_report = ? AND accepted_at <= ? AND parse_status IN ('parsed','partial')`,
    managerCik, period, asOf,
  );
  const { base, additions } = selectFilingsFor13F(filings);
  const used = [...(base ? [base] : []), ...additions];
  if (!used.length) {
    cache.set(key, null);
    return null;
  }
  const placeholders = used.map(() => '?').join(',');
  const rows = all<{ cusip: string; name_of_issuer: string; shares: number; value_usd: number; sh_prn_type: string; put_call: string | null; issuer_cik: string | null; ticker: string | null }>(
    db,
    `SELECT h.cusip, h.name_of_issuer, h.shares, h.value_usd, h.sh_prn_type, h.put_call, s.issuer_cik, s.ticker
     FROM holdings_13f h LEFT JOIN securities s ON s.cusip = h.cusip
     WHERE h.accession IN (${placeholders})`,
    ...used.map((f) => f.accession),
  );
  const positions = new Map<string, ResolvedPosition>();
  const optionRows: Resolved13F['optionRows'] = [];
  let principalRows = 0;
  let total = 0;
  for (const r of rows) {
    if (r.put_call) {
      optionRows.push({ cusip: r.cusip, name: r.name_of_issuer, putCall: r.put_call, shares: r.shares, value: r.value_usd });
      continue;
    }
    if (r.sh_prn_type !== 'SH') {
      principalRows++;
      continue;
    }
    // A manager can report one CUSIP on several rows (e.g. per discretion / other manager) — aggregate.
    const p = positions.get(r.cusip) ?? { cusip: r.cusip, name: r.name_of_issuer, shares: 0, value: 0, issuerCik: r.issuer_cik, ticker: r.ticker };
    p.shares += r.shares;
    p.value += r.value_usd;
    positions.set(r.cusip, p);
    total += r.value_usd;
  }
  const result: Resolved13F = {
    managerCik,
    period,
    accessions: used.map((f) => f.accession),
    acceptedAt: used[used.length - 1].accepted_at,
    baseAccession: (base ?? used[0]).accession,
    amendmentsApplied: used.filter((f) => f.is_amendment).map((f) => ({ accession: f.accession, type: f.amendment_type ?? 'UNKNOWN', acceptedAt: f.accepted_at })),
    positions,
    optionRows,
    principalRows,
    totalEquityValue: total,
    origin: used[0].origin,
  };
  cache.set(key, result);
  return result;
}

/** Reporting periods for which a manager has at least one 13F accepted by `asOf`, newest first. */
export function periodsForManager(db: DB, managerCik: string, asOf: string): string[] {
  return all<{ p: string }>(
    db,
    `SELECT DISTINCT period_of_report AS p FROM filings WHERE filer_cik = ? AND base_form = '13F-HR' AND accepted_at <= ?
       AND parse_status IN ('parsed','partial') AND period_of_report IS NOT NULL ORDER BY p DESC`,
    managerCik, asOf,
  ).map((r) => r.p);
}

// ---------------------------------------------------------------------------
// Period-over-period changes
// ---------------------------------------------------------------------------

export function classifyChange(sharesPrior: number, sharesCurrent: number): PositionChangeKind {
  if (sharesPrior <= 0 && sharesCurrent > 0) return 'new';
  if (sharesPrior > 0 && sharesCurrent <= 0) return 'exited';
  if (sharesCurrent > sharesPrior) return 'increased';
  if (sharesCurrent < sharesPrior) return 'reduced';
  return 'unchanged';
}

/**
 * Split a change in reported market value into the part explained by a change in
 * share count (valued at the prior implied price) and the part explained by the
 * change in implied per-share value (price movement). The two always sum to the
 * total change.  Quarter-end value changes are NOT money flows.
 */
export function decomposeValueChange(sharesPrior: number, valuePrior: number, sharesCurrent: number, valueCurrent: number): { fromShares: number; fromPrice: number } {
  if (sharesPrior <= 0) return { fromShares: valueCurrent - valuePrior, fromPrice: 0 };
  if (sharesCurrent <= 0) return { fromShares: valueCurrent - valuePrior, fromPrice: 0 };
  const pxPrior = valuePrior / sharesPrior;
  const pxCurrent = valueCurrent / sharesCurrent;
  return { fromShares: (sharesCurrent - sharesPrior) * pxPrior, fromPrice: sharesCurrent * (pxCurrent - pxPrior) };
}

export function portfolioWeight(value: number, total: number): number | null {
  return total > 0 ? value / total : null;
}

export interface ManagerChanges {
  managerCik: string;
  managerName: string;
  period: string;
  priorPeriod: string | null;
  current: Resolved13F;
  prior: Resolved13F | null;
  changes: PositionChange[];
  /** True when the prior period found is not the immediately preceding quarter. */
  gapInHistory: boolean;
}

export function computeManagerChanges(db: DB, managerCik: string, managerName: string, period: string, asOf: string, expectedPrior?: string): ManagerChanges | null {
  const current = resolve13F(db, managerCik, period, asOf);
  if (!current) return null;
  const earlier = periodsForManager(db, managerCik, asOf).filter((p) => p < period);
  const priorPeriod = earlier[0] ?? null;
  const prior = priorPeriod ? resolve13F(db, managerCik, priorPeriod, asOf) : null;
  const cusips = new Set<string>([...current.positions.keys(), ...(prior?.positions.keys() ?? [])]);
  const changes: PositionChange[] = [];
  for (const cusip of cusips) {
    const c = current.positions.get(cusip);
    const p = prior?.positions.get(cusip);
    const sharesPrior = p?.shares ?? 0;
    const sharesCurrent = c?.shares ?? 0;
    const valuePrior = p?.value ?? 0;
    const valueCurrent = c?.value ?? 0;
    // Without a prior filing nothing can be called "new" — only report holdings.
    const kind: PositionChangeKind = prior ? classifyChange(sharesPrior, sharesCurrent) : 'unchanged';
    const { fromShares, fromPrice } = decomposeValueChange(sharesPrior, valuePrior, sharesCurrent, valueCurrent);
    const wPrior = prior && p ? portfolioWeight(valuePrior, prior.totalEquityValue) : prior ? 0 : null;
    const wCurrent = c ? portfolioWeight(valueCurrent, current.totalEquityValue) : 0;
    changes.push({
      managerCik,
      managerName,
      cusip,
      issuerCik: c?.issuerCik ?? p?.issuerCik ?? null,
      ticker: c?.ticker ?? p?.ticker ?? null,
      issuerName: c?.name ?? p?.name ?? cusip,
      period,
      priorPeriod,
      kind,
      sharesPrior,
      sharesCurrent,
      shareChange: sharesCurrent - sharesPrior,
      shareChangePct: sharesPrior > 0 ? (sharesCurrent - sharesPrior) / sharesPrior : null,
      valuePrior,
      valueCurrent,
      valueChange: valueCurrent - valuePrior,
      valueChangeFromShares: fromShares,
      valueChangeFromPrice: fromPrice,
      weightPrior: wPrior,
      weightCurrent: wCurrent,
      weightChange: wPrior != null && wCurrent != null ? wCurrent - wPrior : null,
      filingAccession: current.accessions[current.accessions.length - 1],
      filingAcceptedAt: current.acceptedAt,
      priorFilingAccession: prior ? prior.accessions[prior.accessions.length - 1] : null,
      origin: current.origin,
    });
  }
  changes.sort((a, b) => b.valueCurrent - a.valueCurrent);
  return {
    managerCik,
    managerName,
    period,
    priorPeriod,
    current,
    prior,
    changes,
    gapInHistory: !!(priorPeriod && expectedPrior && priorPeriod !== expectedPrior),
  };
}

/** HHI-style concentration and top-10 share of reported equity value. */
export function concentration(r: Resolved13F): { positions: number; top10Weight: number; hhi: number; largestWeight: number } {
  const weights = [...r.positions.values()].map((p) => (r.totalEquityValue > 0 ? p.value / r.totalEquityValue : 0)).sort((a, b) => b - a);
  return {
    positions: weights.length,
    top10Weight: weights.slice(0, 10).reduce((s, w) => s + w, 0),
    hhi: weights.reduce((s, w) => s + w * w, 0),
    largestWeight: weights[0] ?? 0,
  };
}

/**
 * The research period used for cross-manager comparison: the newest quarter for
 * which at least half of the tracked managers had filed by `asOf` (falls back to
 * the newest quarter with any filing).
 */
export function comparablePeriod(db: DB, asOf: string): { period: string | null; filers: number; tracked: number } {
  const tracked = all<{ n: number }>(db, `SELECT COUNT(*) AS n FROM entities WHERE kind = 'manager' AND tracked = 1`)[0]?.n ?? 0;
  const rows = all<{ p: string; n: number }>(
    db,
    `SELECT f.period_of_report AS p, COUNT(DISTINCT f.filer_cik) AS n FROM filings f
     JOIN entities e ON e.cik = f.filer_cik AND e.kind = 'manager' AND e.tracked = 1
     WHERE f.base_form = '13F-HR' AND f.accepted_at <= ? AND f.parse_status IN ('parsed','partial') AND f.period_of_report IS NOT NULL
     GROUP BY f.period_of_report ORDER BY p DESC`,
    asOf,
  );
  const enough = rows.find((r) => r.n >= Math.max(1, Math.ceil(tracked / 2)));
  const pick = enough ?? rows[0];
  return { period: pick?.p ?? null, filers: pick?.n ?? 0, tracked };
}

export function trackedManagers(db: DB): { cik: string; name: string }[] {
  return all<{ cik: string; name: string }>(db, `SELECT cik, name FROM entities WHERE kind = 'manager' AND tracked = 1 ORDER BY name`);
}

/** All tracked managers' changes for one period, as of a cutoff. */
export function allManagerChanges(db: DB, period: string, asOf: string): ManagerChanges[] {
  const out: ManagerChanges[] = [];
  for (const m of trackedManagers(db)) {
    const mc = computeManagerChanges(db, m.cik, m.name, period, asOf);
    if (mc) out.push(mc);
  }
  return out;
}
