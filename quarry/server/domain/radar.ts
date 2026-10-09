import type { DB } from '../db/index.ts';
import type {
  CorporateEvent, DataOrigin, Evidence, InsiderTransaction, PositionChange, RadarCandidate, RadarCategory, RankingInput, ResearchMode,
} from '../../shared/types.ts';
import { allManagerChanges, comparablePeriod } from './thirteenF.ts';
import { listEvents, listInsiderTransactions, getEntity } from './queries.ts';
import { isQualifyingOpenMarketPurchase } from './form4Codes.ts';
import { eventRelevance } from './events8k.ts';
import { classifyFreshness } from './freshness.ts';
import { clamp01, computeRanking, recencyScore } from './ranking.ts';
import { addDays, daysBetween } from './asof.ts';
import type { MarketDataProvider } from '../market/provider.ts';
import { marketContext, type MarketContext } from '../market/stats.ts';

export const CATEGORY_META: Record<RadarCategory, { label: string; mode: ResearchMode; description: string }> = {
  institutional_accumulation: { label: 'Institutional accumulation', mode: 'positioning', description: 'Two or more tracked managers reported share counts at least 5% higher in an existing position for the same quarter.' },
  new_positions: { label: 'New institutional positions', mode: 'positioning', description: 'A tracked manager reported a holding that was absent from its prior 13F.' },
  broad_interest: { label: 'Broad-based interest', mode: 'positioning', description: 'Three or more tracked managers added (≥5%) or initiated, with adders outnumbering reducers by at least two.' },
  institutional_reduction: { label: 'Institutional reduction', mode: 'positioning', description: 'Two or more tracked managers reported share counts at least 5% lower, or exited.' },
  insider_buying: { label: 'Insider buying', mode: 'event', description: 'Open-market purchases (Form 4 code P, non-derivative, priced, not under a 10b5-1 plan) in the last 90 days.' },
  activist: { label: 'Activist activity', mode: 'event', description: 'Schedule 13D filings or amendments (beneficial owner >5% who may seek to influence) in the last 180 days.' },
  corporate_events: { label: 'Corporate event watch', mode: 'event', description: 'Form 8-K reports with higher-relevance items in the last 30 days.' },
  unusual_market: { label: 'Unusual market activity', mode: 'event', description: 'Latest session volume or return at least 2.5 standard deviations from recent history. Requires a market-data provider.' },
};

/** Increases/reductions smaller than this (as a share of the prior position) are treated as routine rebalancing, not radar evidence. */
export const MATERIAL_SHARE_CHANGE = 0.05;
const isMaterial = (c: PositionChange) => c.kind === 'new' || c.kind === 'exited' || Math.abs(c.shareChangePct ?? 0) >= MATERIAL_SHARE_CHANGE;

const LIMITS_13F = [
  '13F reports are quarter-end snapshots filed up to 45 days later. Trades may have happened at any time in the quarter, or been reversed since.',
  'Only long positions in 13(f) securities are reported — no short positions, cash, or most non-US holdings. Purchase dates and prices are not disclosed.',
  'Reported value changes include price movement. Share-count changes are shown separately and are what classify a change.',
];
const LIMITS_FORM4 = [
  'Insiders may buy for many reasons; purchases can be small relative to their holdings or compensation.',
  'Awards, option exercises, tax withholding, gifts and 10b5-1 plan purchases are excluded from this signal.',
];
const LIMITS_13D = ['A 13D signals a >5% holder that may seek to influence the company; intent and outcomes vary widely. Read Item 4 (purpose) in the filing.'];
const LIMITS_8K = ['Item relevance weights are editorial and indicate how often an item warrants follow-up — not its price impact.'];
const LIMITS_MARKET = ['Statistical unusualness is not explanatory; check for news, index events or data errors before drawing conclusions.'];

export interface RadarContext {
  db: DB;
  asOf: string;
  now: string;
  market: MarketDataProvider;
  watchIssuers: Set<string>;
}

export interface RadarResult {
  asOf: string;
  period: string | null;
  periodFilers: number;
  trackedManagers: number;
  candidates: RadarCandidate[];
  categoryStatus: Record<RadarCategory, { available: boolean; message: string; count: number }>;
  unmappedChanges: number;
}

const fmtPct = (x: number | null) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const fmtUsd = (x: number) => (Math.abs(x) >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x).toLocaleString('en-US')}`);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function input(key: string, label: string, weight: number, normalized: number | null, raw: string, formula: string): RankingInput {
  return { key, label, weight, normalized: normalized == null ? null : clamp01(normalized), raw, formula };
}

function marketInput(mc: MarketContext | null | undefined, available: boolean): RankingInput {
  if (!available || !mc) return input('market', 'Market context', 10, null, available ? 'No bars for ticker' : 'No market-data provider', 'min(max(|volume z|, |return z|) ÷ 3, 1)');
  const z = Math.max(Math.abs(mc.volumeZ ?? 0), Math.abs(mc.returnZ ?? 0));
  return input('market', 'Market context', 10, z / 3, `volume z ${mc.volumeZ?.toFixed(2) ?? 'n/a'}, return z ${mc.returnZ?.toFixed(2) ?? 'n/a'}`, 'min(max(|volume z|, |return z|) ÷ 3, 1)');
}

export async function buildRadar(ctx: RadarContext): Promise<RadarResult> {
  const { db, asOf, now } = ctx;
  const { period, filers, tracked } = comparablePeriod(db, asOf);
  const changes = period ? allManagerChanges(db, period, asOf).flatMap((m) => m.changes) : [];
  const unmapped = changes.filter((c) => !c.issuerCik && c.kind !== 'unchanged').length;

  const byIssuer = new Map<string, PositionChange[]>();
  for (const c of changes) {
    if (!c.issuerCik) continue;
    (byIssuer.get(c.issuerCik) ?? byIssuer.set(c.issuerCik, []).get(c.issuerCik)!).push(c);
  }

  const insider = listInsiderTransactions(db, { asOf, sinceDays: 90 });
  const qualifying = insider.filter((t) => isQualifyingOpenMarketPurchase({ ...t, is10b51: t.is10b51 }));
  const buysByIssuer = new Map<string, InsiderTransaction[]>();
  for (const t of qualifying) (buysByIssuer.get(t.issuerCik) ?? buysByIssuer.set(t.issuerCik, []).get(t.issuerCik)!).push(t);

  const events8k = listEvents(db, { asOf, sinceDays: 30, forms: ['8-K'] });
  const relevant8k = dedupeEvents(events8k).filter((e) => eventRelevance(e.items.map((i) => i.code)) >= 0.6);
  const eventsByIssuer = new Map<string, CorporateEvent[]>();
  for (const e of relevant8k) (eventsByIssuer.get(e.issuerCik) ?? eventsByIssuer.set(e.issuerCik, []).get(e.issuerCik)!).push(e);

  const activist = listEvents(db, { asOf, sinceDays: 180, forms: ['SC 13D'] });
  const activistByIssuer = new Map<string, CorporateEvent[]>();
  for (const e of activist) (activistByIssuer.get(e.issuerCik) ?? activistByIssuer.set(e.issuerCik, []).get(e.issuerCik)!).push(e);

  // Market context for issuers with any signal (bounded for external providers).
  const providerStatus = ctx.market.status();
  const marketAvailable = providerStatus.configured;
  const issuerSet = new Set<string>([...byIssuer.keys(), ...buysByIssuer.keys(), ...eventsByIssuer.keys(), ...activistByIssuer.keys()]);
  if (marketAvailable) {
    for (const r of db.prepare(`SELECT cik FROM entities WHERE kind = 'issuer' AND tracked = 1`).all() as { cik: string }[]) issuerSet.add(r.cik);
  }
  const mcByIssuer = new Map<string, MarketContext | null>();
  if (marketAvailable) {
    const list = [...issuerSet].slice(0, providerStatus.isDemo ? 500 : 40);
    await Promise.all(list.map(async (cik) => {
      const e = getEntity(db, cik);
      if (!e?.ticker) return;
      const h = await ctx.market.getHistory(e.ticker, addDays(asOf, -150), asOf);
      mcByIssuer.set(cik, h ? marketContext(h.bars) : null);
    }));
  }

  const insiderInput = (cik: string): RankingInput => {
    const n = new Set((buysByIssuer.get(cik) ?? []).map((t) => t.ownerCik)).size;
    return input('insider_confirmation', 'Insider purchase confirmation', 10, n / 2, `${n} insider(s) with qualifying purchases, 90 days`, 'min(distinct insiders with code-P purchases ÷ 2, 1)');
  };
  const eventInput = (cik: string): RankingInput => {
    const rel = Math.max(0, ...(eventsByIssuer.get(cik) ?? []).map((e) => eventRelevance(e.items.map((i) => i.code))));
    return input('event_relevance', 'Corporate event relevance', 10, rel, rel ? `max item relevance ${rel.toFixed(2)}` : 'no relevant 8-K in 30 days', 'highest 8-K item relevance weight in 30 days (0–1)');
  };
  const institutionalInput = (cik: string): RankingInput => {
    const adders = new Set((byIssuer.get(cik) ?? []).filter((c) => c.kind === 'new' || c.kind === 'increased').map((c) => c.managerCik)).size;
    return input('institutional_context', 'Institutional context (13F, supplemental)', 10, period ? adders / 3 : null, period ? `${adders} tracked manager(s) added in ${period}` : 'No 13F period available', 'min(managers adding in comparable quarter ÷ 3, 1)');
  };

  const candidates: RadarCandidate[] = [];
  const entityCache = new Map<string, ReturnType<typeof getEntity>>();
  const ent = (cik: string) => (entityCache.has(cik) ? entityCache.get(cik) : entityCache.set(cik, getEntity(db, cik)).get(cik));

  const push = (cik: string, category: RadarCategory, partial: Omit<RadarCandidate, 'id' | 'category' | 'mode' | 'issuerCik' | 'ticker' | 'issuerName' | 'sector' | 'marketCap' | 'onWatchlist' | 'hasMarketConfirmation' | 'freshness' | 'ranking'> & { inputs: RankingInput[]; freshnessKind: 'holdings' | 'filing' | 'market' }) => {
    const e = ent(cik);
    const mc = mcByIssuer.get(cik);
    const { inputs, freshnessKind, ...rest } = partial;
    const freshness = freshnessKind === 'holdings'
      ? classifyFreshness({ kind: 'holdings', origin: rest.origin, acceptedAt: rest.latestAcceptedAt, periodOfReport: rest.periodOfReport, now: asOf })
      : freshnessKind === 'market'
        ? classifyFreshness({ kind: 'market', origin: providerStatus.isDemo ? 'demo' : rest.origin, observedAt: rest.latestAcceptedAt, delayMinutes: null, now: asOf })
        : classifyFreshness({ kind: 'filing', origin: rest.origin, acceptedAt: rest.latestAcceptedAt, now: asOf });
    candidates.push({
      ...rest,
      id: `${category}:${cik}:${rest.periodOfReport ?? rest.eventDate ?? ''}`,
      category,
      mode: CATEGORY_META[category].mode,
      issuerCik: cik,
      ticker: e?.ticker ?? null,
      issuerName: e?.name ?? cik,
      sector: e?.sector ?? null,
      marketCap: e?.market_cap ?? null,
      freshness,
      ranking: computeRanking(inputs, asOf, now, rest.limitations),
      hasMarketConfirmation: !!mc && Math.max(Math.abs(mc.volumeZ ?? 0), Math.abs(mc.returnZ ?? 0)) >= 1.5,
      onWatchlist: ctx.watchIssuers.has(cik),
    });
  };

  // ---- Positioning mode (13F) -------------------------------------------
  for (const [cik, list] of byIssuer) {
    const material = list.filter(isMaterial);
    const groups = {
      increased: material.filter((c) => c.kind === 'increased'),
      new: material.filter((c) => c.kind === 'new'),
      reduced: material.filter((c) => c.kind === 'reduced' || c.kind === 'exited'),
    };
    const adders = [...groups.increased, ...groups.new];
    const mk = (category: RadarCategory, supporters: PositionChange[], headline: string, whatChanged: string, why: string, magnitudeRaw: number[], magLabel: string) => {
      const managers = new Set(supporters.map((s) => s.managerCik));
      const latest = supporters.map((s) => s.filingAcceptedAt).sort().at(-1)!;
      const mag = median(magnitudeRaw);
      const origin: DataOrigin = supporters[0].origin;
      push(cik, category, {
        headline,
        supportingCount: managers.size,
        eventDate: null,
        latestAcceptedAt: latest,
        periodOfReport: period,
        whatChanged,
        whyItMatters: why,
        verifyNext: [
          'Open each manager filing and confirm the share counts and CUSIP.',
          'Check whether the position is material to each manager (portfolio weight).',
          'Look for later Form 4, 13D/13G or 8-K filings that update the picture after quarter-end.',
          marketAvailable ? 'Compare the current price with the quarter-end implied price.' : 'Configure market data to compare current price with quarter-end implied values.',
        ],
        limitations: LIMITS_13F,
        evidence: supporters.map((s) => evidenceFromChange(s)),
        formTypes: ['13F-HR'],
        origin,
        freshnessKind: 'holdings',
        inputs: [
          input('breadth', 'Independent supporting managers', 30, managers.size / 5, `${managers.size} manager(s)`, 'min(distinct tracked managers ÷ 5, 1); one count per manager regardless of amendments'),
          input('magnitude', magLabel, 25, Math.min(Math.abs(mag), 1), fmtPct(mag), 'min(|median share-count change| ÷ 100%, 1); new positions count as 100%'),
          input('recency', 'Filing recency', 20, recencyScore(daysBetween(latest, asOf), 60), `${Math.floor(daysBetween(latest, asOf))} days since latest acceptance`, '0.5 ^ (days since acceptance ÷ 60)'),
          insiderInput(cik),
          marketInput(mc(cik), marketAvailable),
        ],
      });
    };
    const mc = (c: string) => mcByIssuer.get(c);
    const pctOf = (cs: PositionChange[]) => cs.map((c) => (c.kind === 'new' ? 1 : c.kind === 'exited' ? -1 : c.shareChangePct ?? 0));
    if (new Set(groups.increased.map((c) => c.managerCik)).size >= 2) {
      mk('institutional_accumulation', groups.increased, `${groups.increased.length} tracked managers reported larger positions`,
        groups.increased.map((c) => `${c.managerName}: ${fmtShares(c.sharesPrior)} → ${fmtShares(c.sharesCurrent)} shares (${fmtPct(c.shareChangePct)})`).join('; '),
        'Several independent managers raising reported share counts in the same quarter can indicate shared conviction worth researching.',
        pctOf(groups.increased), 'Median share-count increase');
    }
    if (groups.new.length >= 1) {
      mk('new_positions', groups.new, `${groups.new.length} new reported position${groups.new.length > 1 ? 's' : ''}`,
        groups.new.map((c) => `${c.managerName} reported ${fmtShares(c.sharesCurrent)} shares (${fmtPct(c.weightCurrent)} of reported equity value)`).join('; '),
        'A newly reported holding shows a manager began (or resumed) owning the stock during the quarter.',
        pctOf(groups.new), 'Position size (new = 100%)');
    }
    const adderSet = new Set(adders.map((c) => c.managerCik));
    const reducerSet = new Set(groups.reduced.map((c) => c.managerCik));
    if (adderSet.size >= 3 && adderSet.size - reducerSet.size >= 2) {
      mk('broad_interest', adders, `${adderSet.size} managers added vs ${reducerSet.size} reduced`,
        `${adderSet.size} tracked managers increased or initiated; ${reducerSet.size} reduced or exited in ${period}.`,
        'Breadth across many independent managers is harder to explain by a single manager’s idiosyncrasies.',
        pctOf(adders), 'Median share-count change of adders');
    }
    if (reducerSet.size >= 2) {
      mk('institutional_reduction', groups.reduced, `${reducerSet.size} tracked managers reduced or exited`,
        groups.reduced.map((c) => `${c.managerName}: ${c.kind === 'exited' ? 'exited' : `${fmtShares(c.sharesPrior)} → ${fmtShares(c.sharesCurrent)}`}`).join('; '),
        'Multiple reductions can flag waning conviction — or routine rebalancing, tax or liquidity needs.',
        pctOf(groups.reduced), 'Median share-count reduction');
    }
  }

  // ---- Event mode: insider buying -----------------------------------------
  for (const [cik, buys] of buysByIssuer) {
    const owners = new Map<string, InsiderTransaction[]>();
    for (const b of buys) (owners.get(b.ownerCik) ?? owners.set(b.ownerCik, []).get(b.ownerCik)!).push(b);
    const total = buys.reduce((s, b) => s + (b.value ?? 0), 0);
    const latest = buys.map((b) => b.acceptedAt).sort().at(-1)!;
    const latestTxn = buys.map((b) => b.transactionDate).sort().at(-1)!;
    push(cik, 'insider_buying', {
      headline: `${owners.size} insider${owners.size > 1 ? 's' : ''} bought ${fmtUsd(total)} on the open market`,
      supportingCount: owners.size,
      eventDate: latestTxn,
      latestAcceptedAt: latest,
      periodOfReport: null,
      whatChanged: [...owners.values()].map((ts) => `${ts[0].ownerName} (${ts[0].ownerRole}): ${ts.length} purchase(s), ${fmtUsd(ts.reduce((s, t) => s + (t.value ?? 0), 0))}`).join('; '),
      whyItMatters: 'Open-market purchases use the insider’s own money at market prices, unlike awards or option exercises.',
      verifyNext: ['Read footnotes for weighted-average prices and indirect ownership.', 'Compare purchase size with the insider’s remaining holdings.', 'Check for a trading-window context (e.g. after earnings).'],
      limitations: LIMITS_FORM4,
      evidence: buys.map(evidenceFromTxn),
      formTypes: ['4'],
      origin: buys[0].origin,
      freshnessKind: 'filing',
      inputs: [
        input('breadth', 'Distinct insiders buying', 30, owners.size / 3, `${owners.size} insider(s)`, 'min(distinct reporting owners ÷ 3, 1); joint filings and amendments counted once'),
        input('magnitude', 'Aggregate purchase value', 25, Math.log10(Math.max(1, total)) / 6, fmtUsd(total), 'min(log10(total $) ÷ 6, 1) — $1M ≈ 1.0'),
        input('recency', 'Filing recency', 20, recencyScore(daysBetween(latest, asOf), 14), `${Math.floor(daysBetween(latest, asOf))} days since latest acceptance`, '0.5 ^ (days since acceptance ÷ 14)'),
        institutionalInput(cik),
        eventInput(cik),
        marketInput(mcByIssuer.get(cik), marketAvailable),
      ],
    });
  }

  // ---- Event mode: activist (13D) ----------------------------------------
  for (const [cik, filings] of activistByIssuer) {
    const filersSet = new Set(filings.map((f) => f.filerName ?? f.accession));
    const maxPct = Math.max(0, ...filings.map((f) => f.percentOfClass ?? 0));
    const latest = filings.map((f) => f.acceptedAt).sort().at(-1)!;
    push(cik, 'activist', {
      headline: `${[...filersSet][0]}${filersSet.size > 1 ? ` +${filersSet.size - 1}` : ''}: Schedule 13D${filings.some((f) => f.isAmendment) ? ' with amendments' : ''}`,
      supportingCount: filersSet.size,
      eventDate: filings.map((f) => f.eventDate).filter(Boolean).sort().at(-1) ?? null,
      latestAcceptedAt: latest,
      periodOfReport: null,
      whatChanged: filings.map((f) => `${f.formType} ${f.percentOfClass != null ? `${f.percentOfClass.toFixed(1)}% of class` : '(percentage not parsed)'} accepted ${f.acceptedAt.slice(0, 10)}`).join('; '),
      whyItMatters: 'Schedule 13D filers hold more than 5% and may seek to influence strategy, governance or capital allocation.',
      verifyNext: ['Read Item 4 (purpose of transaction).', 'Track subsequent 13D/A amendments for changes in stake or intent.', 'Check for 8-K items 1.01 / 5.02 indicating agreements or board changes.'],
      limitations: LIMITS_13D,
      evidence: filings.map(evidenceFromEvent),
      formTypes: [...new Set(filings.map((f) => f.formType))],
      origin: filings[0].origin,
      freshnessKind: 'filing',
      inputs: [
        input('breadth', 'Distinct 13D filers', 30, filersSet.size / 2, `${filersSet.size} filer(s)`, 'min(distinct filers ÷ 2, 1); amendments by the same filer counted once'),
        input('magnitude', 'Largest stake disclosed', 25, maxPct ? maxPct / 10 : null, maxPct ? `${maxPct.toFixed(1)}%` : 'not parsed', 'min(percent of class ÷ 10%, 1)'),
        input('recency', 'Filing recency', 20, recencyScore(daysBetween(latest, asOf), 30), `${Math.floor(daysBetween(latest, asOf))} days`, '0.5 ^ (days since acceptance ÷ 30)'),
        insiderInput(cik),
        marketInput(mcByIssuer.get(cik), marketAvailable),
      ],
    });
  }

  // ---- Event mode: 8-K corporate events ----------------------------------
  for (const [cik, evs] of eventsByIssuer) {
    const rel = Math.max(...evs.map((e) => eventRelevance(e.items.map((i) => i.code))));
    const latest = evs.map((e) => e.acceptedAt).sort().at(-1)!;
    const top = [...evs].sort((a, b) => eventRelevance(b.items.map((i) => i.code)) - eventRelevance(a.items.map((i) => i.code)))[0];
    push(cik, 'corporate_events', {
      headline: top.headline,
      supportingCount: evs.length,
      eventDate: top.eventDate,
      latestAcceptedAt: latest,
      periodOfReport: null,
      whatChanged: evs.map((e) => `${e.formType} (${e.items.map((i) => i.code).join(', ')}): ${e.headline}`).join('; '),
      whyItMatters: 'Form 8-K reports material events within four business days; some items frequently precede re-pricing.',
      verifyNext: ['Read the 8-K body and exhibits (press release in Ex. 99.1).', 'Check price and volume around the acceptance time.', 'Look for related insider or ownership filings.'],
      limitations: LIMITS_8K,
      evidence: evs.map(evidenceFromEvent),
      formTypes: [...new Set(evs.map((e) => e.formType))],
      origin: evs[0].origin,
      freshnessKind: 'filing',
      inputs: [
        input('breadth', 'Relevant events', 30, evs.length / 3, `${evs.length} distinct event(s)`, 'min(distinct 8-K events ÷ 3, 1); 8-K/A merged with its original'),
        input('magnitude', 'Highest item relevance', 25, rel, rel.toFixed(2), 'highest item relevance weight (0–1)'),
        input('recency', 'Filing recency', 20, recencyScore(daysBetween(latest, asOf), 7), `${Math.floor(daysBetween(latest, asOf))} days`, '0.5 ^ (days since acceptance ÷ 7)'),
        insiderInput(cik),
        marketInput(mcByIssuer.get(cik), marketAvailable),
      ],
    });
  }

  // ---- Event mode: unusual market activity -------------------------------
  if (marketAvailable) {
    for (const [cik, mc] of mcByIssuer) {
      if (!mc) continue;
      const z = Math.max(Math.abs(mc.volumeZ ?? 0), Math.abs(mc.returnZ ?? 0));
      if (z < 2.5) continue;
      const observedAt = `${mc.lastDate}T21:00:00.000Z`;
      push(cik, 'unusual_market', {
        headline: `Volume z ${mc.volumeZ?.toFixed(1) ?? 'n/a'} · return z ${mc.returnZ?.toFixed(1) ?? 'n/a'} on ${mc.lastDate}`,
        supportingCount: 1,
        eventDate: mc.lastDate,
        latestAcceptedAt: observedAt,
        periodOfReport: null,
        whatChanged: `Last close ${mc.lastClose.toFixed(2)}; 5-day return ${fmtPct(mc.return5d)}; average 50-day volume ${mc.avgVolume50 ? Math.round(mc.avgVolume50).toLocaleString('en-US') : 'n/a'}.`,
        whyItMatters: 'Unusual price or volume can reflect new information reaching the market before or alongside filings.',
        verifyNext: ['Look for 8-K, Form 4 or 13D filings around the same date.', 'Check index rebalances, options expiry or corporate actions.', 'Confirm with a second data source.'],
        limitations: [...LIMITS_MARKET, ...(providerStatus.isDemo ? ['Demo prices are simulated.'] : [])],
        evidence: [{ kind: 'market', summary: `Daily bar ${mc.lastDate} from ${providerStatus.name}`, accession: null, acceptedAt: null, periodOfReport: null, eventDate: mc.lastDate, sourceUrl: null, origin: providerStatus.isDemo ? 'demo' : 'sec' }],
        formTypes: [],
        origin: providerStatus.isDemo ? 'demo' : 'sec',
        freshnessKind: 'market',
        inputs: [
          input('magnitude', 'Statistical unusualness', 25, z / 4, `max |z| ${z.toFixed(2)}`, 'min(max(|volume z|, |return z|) ÷ 4, 1)'),
          input('recency', 'Bar recency', 20, recencyScore(daysBetween(observedAt, asOf), 3), mc.lastDate, '0.5 ^ (days since bar ÷ 3)'),
          eventInput(cik),
          insiderInput(cik),
          institutionalInput(cik),
        ],
      });
    }
  }

  candidates.sort((a, b) => b.ranking.score - a.ranking.score || b.latestAcceptedAt.localeCompare(a.latestAcceptedAt) || a.id.localeCompare(b.id));

  const count = (c: RadarCategory) => candidates.filter((x) => x.category === c).length;
  const categoryStatus = Object.fromEntries(
    (Object.keys(CATEGORY_META) as RadarCategory[]).map((c) => {
      const isMarket = c === 'unusual_market';
      const available = isMarket ? marketAvailable : c.startsWith('institutional') || c === 'new_positions' || c === 'broad_interest' ? !!period : true;
      const message = isMarket && !marketAvailable
        ? 'Requires a configured market-data provider.'
        : !available
          ? 'No 13F data available for the selected cutoff.'
          : isMarket && providerStatus.isDemo ? 'Computed from simulated demo prices.' : CATEGORY_META[c].description;
      return [c, { available, message, count: count(c) }];
    }),
  ) as RadarResult['categoryStatus'];

  return { asOf, period, periodFilers: filers, trackedManagers: tracked, candidates, categoryStatus, unmappedChanges: unmapped };
}

/** Collapse 8-K/A amendments into their original event (same issuer, event date and item set). */
export function dedupeEvents(events: CorporateEvent[]): CorporateEvent[] {
  const byKey = new Map<string, CorporateEvent>();
  for (const e of [...events].sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt))) {
    const key = `${e.issuerCik}|${e.eventDate ?? e.acceptedAt.slice(0, 10)}|${e.items.map((i) => i.code).filter((c) => c !== '9.01').sort().join(',')}`;
    if (!byKey.has(key)) byKey.set(key, e);
  }
  return [...byKey.values()];
}

function fmtShares(n: number): string {
  return Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`;
}

function evidenceFromChange(c: PositionChange): Evidence {
  const verb = { new: 'initiated', increased: 'increased', reduced: 'reduced', exited: 'exited', unchanged: 'held' }[c.kind];
  return {
    kind: 'position_change',
    summary: `${c.managerName} ${verb}: ${fmtShares(c.sharesPrior)} → ${fmtShares(c.sharesCurrent)} shares (${c.priorPeriod ?? 'n/a'} → ${c.period}); value change ${fmtUsd(c.valueChange)} of which ${fmtUsd(c.valueChangeFromPrice)} from price`,
    accession: c.filingAccession,
    acceptedAt: c.filingAcceptedAt,
    periodOfReport: c.period,
    eventDate: null,
    sourceUrl: null,
    origin: c.origin,
  };
}

function evidenceFromTxn(t: InsiderTransaction): Evidence {
  return {
    kind: 'insider_transaction',
    summary: `${t.ownerName} (${t.ownerRole}) — ${t.classificationLabel} [${t.code}] ${t.shares.toLocaleString('en-US')} sh @ ${t.price != null ? `$${t.price.toFixed(2)}` : 'n/a'} on ${t.transactionDate}`,
    accession: t.accession,
    acceptedAt: t.acceptedAt,
    periodOfReport: null,
    eventDate: t.transactionDate,
    sourceUrl: t.sourceUrl,
    origin: t.origin,
  };
}

function evidenceFromEvent(e: CorporateEvent): Evidence {
  return {
    kind: 'event',
    summary: `${e.formType}: ${e.headline}${e.items.length ? ` — items ${e.items.map((i) => i.code).join(', ')}` : ''}`,
    accession: e.accession,
    acceptedAt: e.acceptedAt,
    periodOfReport: null,
    eventDate: e.eventDate,
    sourceUrl: e.sourceUrl,
    origin: e.origin,
  };
}
