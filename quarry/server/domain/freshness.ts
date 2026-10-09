import type { DataOrigin, Freshness } from '../../shared/types.ts';
import { DAY_MS } from './asof.ts';

// Declared freshness thresholds. Changing them changes classifications only,
// never the underlying data.
export const FRESHNESS = {
  recentlyFiledDays: 7,
  eventStaleDays: 30,             // event-research filings older than this are stale for swing research
  holdingsStaleDays: 45 + 92 * 2, // a 13F period is stale once two newer quarters' deadlines have passed
  marketStaleDays: 4,             // daily bars: allows for weekends/holidays
} as const;

export type FreshnessInput =
  | { kind: 'filing'; origin: DataOrigin; acceptedAt: string | null; now: string }
  | { kind: 'holdings'; origin: DataOrigin; acceptedAt: string | null; periodOfReport: string | null; now: string }
  | { kind: 'market'; origin: DataOrigin; observedAt: string | null; delayMinutes: number | null; now: string }
  | { kind: 'derived'; origin: DataOrigin; inputsAt: string | null; now: string };

const ageDays = (from: string, now: string) => (new Date(now).getTime() - new Date(from).getTime()) / DAY_MS;

export function classifyFreshness(i: FreshnessInput): Freshness {
  const isDemo = i.origin === 'demo';
  const demo = (reason: string): Freshness => ({ status: 'demo', label: 'Demo', reason: `Simulated data. ${reason}`, isDemo: true });

  if (i.kind === 'market') {
    if (!i.observedAt) return { status: 'unavailable', label: 'Unavailable', reason: 'No market data provider is configured or no observation was returned.', isDemo };
    if (isDemo) return demo('Market prices are generated, not observed.');
    const age = ageDays(i.observedAt, i.now);
    if (age > FRESHNESS.marketStaleDays) return { status: 'stale', label: 'Stale', reason: `Last market observation is ${Math.floor(age)} days old.`, isDemo };
    const delay = i.delayMinutes ? `delayed ~${i.delayMinutes} min` : 'provider timestamp';
    return { status: 'market', label: 'Market data', reason: `Observed ${i.observedAt} (${delay}).`, isDemo };
  }

  const at = i.kind === 'derived' ? i.inputsAt : i.acceptedAt;
  if (!at) return { status: 'unavailable', label: 'Unavailable', reason: 'The required disclosure has not been obtained.', isDemo };
  const age = ageDays(at, i.now);

  if (i.kind === 'holdings') {
    const periodNote = i.periodOfReport ? `Positions are as of the ${i.periodOfReport} reporting period, not the filing date.` : '';
    if (isDemo) return demo(periodNote);
    if (i.periodOfReport && ageDays(`${i.periodOfReport}T00:00:00Z`, i.now) > FRESHNESS.holdingsStaleDays) {
      return { status: 'stale', label: 'Stale', reason: `Reporting period ${i.periodOfReport} is more than two quarters old. ${periodNote}`, isDemo };
    }
    if (age <= FRESHNESS.recentlyFiledDays) {
      return { status: 'recently_filed', label: 'Recently filed', reason: `Accepted ${Math.max(0, Math.floor(age))} day(s) ago. ${periodNote} A recent 13F does not mean recent trading.`, isDemo };
    }
    return { status: 'historical', label: 'Historical', reason: periodNote || 'Derived from a past reporting period.', isDemo };
  }

  if (isDemo) return demo('Filing is fictional.');
  if (age <= FRESHNESS.recentlyFiledDays) return { status: 'recently_filed', label: 'Recently filed', reason: `Accepted by EDGAR ${Math.max(0, Math.floor(age))} day(s) ago.`, isDemo };
  if (i.kind === 'filing' && age > FRESHNESS.eventStaleDays) return { status: 'stale', label: 'Stale', reason: `Accepted ${Math.floor(age)} days ago — older than the ${FRESHNESS.eventStaleDays}-day event-research threshold.`, isDemo };
  return { status: 'historical', label: 'Historical', reason: `Accepted ${Math.floor(age)} days ago.`, isDemo };
}
