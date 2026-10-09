import { type DB, all } from '../db/index.ts';
import type { PositionChange } from '../../shared/types.ts';
import {
  allManagerChanges, comparablePeriod, computeManagerChanges, concentration, periodsForManager, resolve13F, trackedManagers,
} from './thirteenF.ts';
import { getEntity, listEvents, listFilings, listInsiderTransactions, type EntityRow } from './queries.ts';
import { classifyFreshness } from './freshness.ts';
import { addDays } from './asof.ts';
import { isQualifyingOpenMarketPurchase } from './form4Codes.ts';
import type { MarketDataProvider } from '../market/provider.ts';
import { eventWindowMove, marketContext } from '../market/stats.ts';

export interface Ctx { db: DB; asOf: string; now: string; market: MarketDataProvider }

const entityView = (e: EntityRow) => ({
  cik: e.cik, name: e.name, ticker: e.ticker, sector: e.sector, marketCap: e.market_cap, marketCapAsOf: e.market_cap_as_of, description: e.description, origin: e.origin,
});

// ---------------------------------------------------------------------------
// Investors
// ---------------------------------------------------------------------------

export function listInvestors(ctx: Ctx) {
  return trackedManagers(ctx.db).map((m) => {
    const periods = periodsForManager(ctx.db, m.cik, ctx.asOf);
    const latest = periods[0] ? resolve13F(ctx.db, m.cik, periods[0], ctx.asOf) : null;
    const e = getEntity(ctx.db, m.cik)!;
    return {
      cik: m.cik, name: m.name, origin: e.origin,
      latestPeriod: periods[0] ?? null,
      acceptedAt: latest?.acceptedAt ?? null,
      positions: latest?.positions.size ?? 0,
      totalValue: latest?.totalEquityValue ?? 0,
      freshness: classifyFreshness({ kind: 'holdings', origin: e.origin, acceptedAt: latest?.acceptedAt ?? null, periodOfReport: periods[0] ?? null, now: ctx.asOf }),
    };
  });
}

export function investorProfile(ctx: Ctx, cik: string, requestedPeriod?: string) {
  const e = getEntity(ctx.db, cik);
  if (!e || e.kind !== 'manager') return null;
  const periods = periodsForManager(ctx.db, cik, ctx.asOf);
  const period = requestedPeriod && periods.includes(requestedPeriod) ? requestedPeriod : periods[0] ?? null;
  const mc = period ? computeManagerChanges(ctx.db, cik, e.name, period, ctx.asOf) : null;
  const history = periods.slice(0, 8).map((p) => {
    const r = resolve13F(ctx.db, cik, p, ctx.asOf)!;
    return { period: p, acceptedAt: r.acceptedAt, accessions: r.accessions, amendments: r.amendmentsApplied, positions: r.positions.size, totalValue: r.totalEquityValue, concentration: concentration(r) };
  });
  // Share-count history for the current top positions across periods (reported values only).
  const top = mc ? mc.changes.filter((c) => c.sharesCurrent > 0).slice(0, 10) : [];
  const positionHistory = top.map((c) => ({
    cusip: c.cusip, ticker: c.ticker, issuerName: c.issuerName, issuerCik: c.issuerCik,
    points: [...periods].reverse().slice(-8).map((p) => {
      const pos = resolve13F(ctx.db, cik, p, ctx.asOf)?.positions.get(c.cusip);
      return { period: p, shares: pos?.shares ?? 0, value: pos?.value ?? 0 };
    }),
  }));
  const count = (k: PositionChange['kind']) => mc?.changes.filter((c) => c.kind === k).length ?? 0;
  return {
    manager: entityView(e),
    periods,
    period,
    priorPeriod: mc?.priorPeriod ?? null,
    filing: mc ? { accessions: mc.current.accessions, acceptedAt: mc.current.acceptedAt, amendments: mc.current.amendmentsApplied, optionRows: mc.current.optionRows, principalRows: mc.current.principalRows } : null,
    freshness: classifyFreshness({ kind: 'holdings', origin: e.origin, acceptedAt: mc?.current.acceptedAt ?? null, periodOfReport: period, now: ctx.asOf }),
    totals: mc ? { totalValue: mc.current.totalEquityValue, priorTotalValue: mc.prior?.totalEquityValue ?? null, positions: mc.current.positions.size } : null,
    summary: { new: count('new'), increased: count('increased'), reduced: count('reduced'), exited: count('exited'), unchanged: count('unchanged') },
    concentration: mc ? concentration(mc.current) : null,
    changes: mc?.changes ?? [],
    history,
    positionHistory,
    filings: listFilings(ctx.db, { asOf: ctx.asOf, now: ctx.asOf, cik, limit: 30 }),
    notes: [
      'Holdings are reported share counts and values at quarter end. Value changes are split into share-count and price components.',
      'Portfolio weights are derived (position value ÷ total reported long equity value excluding options).',
      'Purchase dates and prices are not disclosed in 13F filings.',
    ],
  };
}

// ---------------------------------------------------------------------------
// Stocks
// ---------------------------------------------------------------------------

export function listStocks(ctx: Ctx) {
  return all<EntityRow>(ctx.db, `SELECT * FROM entities WHERE kind = 'issuer' AND tracked = 1 ORDER BY ticker`).map(entityView);
}

export async function stockProfile(ctx: Ctx, issuer: EntityRow) {
  const { db, asOf } = ctx;
  const cp = comparablePeriod(db, asOf);
  const changes = cp.period ? allManagerChanges(db, cp.period, asOf).flatMap((m) => m.changes).filter((c) => c.issuerCik === issuer.cik) : [];
  const holders = changes.filter((c) => c.sharesCurrent > 0).sort((a, b) => b.sharesCurrent - a.sharesCurrent);
  const dir = (k: PositionChange['kind'][]) => changes.filter((c) => k.includes(c.kind)).length;
  const insider = listInsiderTransactions(db, { asOf, issuerCik: issuer.cik, sinceDays: 365 });
  const events = listEvents(db, { asOf, issuerCik: issuer.cik, sinceDays: 365 });
  const fundamentals = all<{ concept: string; label: string; unit: string; period_end: string; fiscal_period: string | null; value: number; filed: string; accession: string; form: string; origin: string }>(
    db, `SELECT concept, label, unit, period_end, fiscal_period, value, filed, accession, form, origin FROM fundamentals WHERE issuer_cik = ? AND filed <= ? ORDER BY period_end DESC, filed DESC`, issuer.cik, asOf.slice(0, 10),
  );
  const latestFund: Record<string, (typeof fundamentals)[number]> = {};
  for (const f of fundamentals) if (!latestFund[f.label]) latestFund[f.label] = f;

  const status = ctx.market.status();
  const hist = issuer.ticker && status.configured ? await ctx.market.getHistory(issuer.ticker, addDays(asOf, -400), asOf) : null;
  const mc = hist ? marketContext(hist.bars) : null;
  const eventMoves = hist
    ? [...events.filter((e) => e.category === 'corporate_event'), ...insider.filter(isQualifyingOpenMarketPurchase).map((t) => ({ eventDate: t.transactionDate, accession: t.accession, headline: `Insider purchase by ${t.ownerName}` }))]
        .filter((e, i, arr) => arr.findIndex((x) => x.eventDate === e.eventDate && x.headline === e.headline) === i)
        .slice(0, 8).map((e) => ({ accession: e.accession, headline: e.headline, eventDate: e.eventDate, move: e.eventDate ? eventWindowMove(hist.bars, e.eventDate) : null }))
    : [];

  const timeline = [
    ...changes.filter((c) => c.kind !== 'unchanged').map((c) => ({ at: c.filingAcceptedAt, type: '13F', title: `${c.managerName} ${c.kind} (${c.period})`, accession: c.filingAccession, sourceUrl: null as string | null, origin: c.origin, periodOfReport: c.period as string | null, eventDate: null as string | null })),
    ...insider.map((t) => ({ at: t.acceptedAt, type: 'Form 4', title: `${t.ownerName}: ${t.classificationLabel} ${t.shares.toLocaleString('en-US')} sh`, accession: t.accession, sourceUrl: t.sourceUrl, origin: t.origin, periodOfReport: null, eventDate: t.transactionDate })),
    ...events.map((e) => ({ at: e.acceptedAt, type: e.formType, title: e.headline, accession: e.accession, sourceUrl: e.sourceUrl, origin: e.origin, periodOfReport: null, eventDate: e.eventDate })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60);

  return {
    issuer: entityView(issuer),
    period: cp.period,
    ownership: {
      holders: holders.map((c) => ({ managerCik: c.managerCik, managerName: c.managerName, shares: c.sharesCurrent, value: c.valueCurrent, weight: c.weightCurrent, kind: c.kind, accession: c.filingAccession, acceptedAt: c.filingAcceptedAt })),
      freshness: classifyFreshness({ kind: 'holdings', origin: issuer.origin, acceptedAt: changes.map((c) => c.filingAcceptedAt).sort().at(-1) ?? null, periodOfReport: cp.period, now: asOf }),
    },
    changes: changes.filter((c) => c.kind !== 'unchanged'),
    breadth: { holders: holders.length, new: dir(['new']), increased: dir(['increased']), reduced: dir(['reduced']), exited: dir(['exited']), unchanged: dir(['unchanged']), trackedManagers: cp.tracked },
    insider: {
      transactions: insider,
      summary: {
        openMarketBuys: insider.filter(isQualifyingOpenMarketPurchase).length,
        openMarketSales: insider.filter((t) => t.classification === 'open_market_sale').length,
        other: insider.filter((t) => !['open_market_purchase', 'open_market_sale'].includes(t.classification)).length,
      },
    },
    events,
    market: {
      provider: status,
      quote: hist ? { price: mc!.lastClose, asOf: hist.observedAt, delay: hist.delay, isDemo: hist.isDemo, provider: hist.provider } : null,
      context: mc,
      bars: hist?.bars.slice(-260) ?? [],
      eventMoves,
      freshness: classifyFreshness({ kind: 'market', origin: hist?.isDemo ? 'demo' : 'sec', observedAt: hist?.observedAt ?? null, delayMinutes: hist?.delayMinutes ?? null, now: asOf }),
    },
    fundamentals: { latest: Object.values(latestFund), series: fundamentals.slice(0, 40) },
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------

export function compareInvestors(ctx: Ctx, ciks: string[]) {
  const cp = comparablePeriod(ctx.db, ctx.asOf);
  const sides = ciks.map((cik) => {
    const e = getEntity(ctx.db, cik);
    if (!e || e.kind !== 'manager') return null;
    const period = cp.period && periodsForManager(ctx.db, cik, ctx.asOf).includes(cp.period) ? cp.period : periodsForManager(ctx.db, cik, ctx.asOf)[0];
    const mc = period ? computeManagerChanges(ctx.db, cik, e.name, period, ctx.asOf) : null;
    const sectors: Record<string, number> = {};
    if (mc) {
      for (const p of mc.current.positions.values()) {
        const sector = (p.issuerCik && getEntity(ctx.db, p.issuerCik)?.sector) || 'Unmapped';
        sectors[sector] = (sectors[sector] ?? 0) + (mc.current.totalEquityValue ? p.value / mc.current.totalEquityValue : 0);
      }
    }
    return {
      cik, name: e.name, origin: e.origin, period, priorPeriod: mc?.priorPeriod ?? null, acceptedAt: mc?.current.acceptedAt ?? null,
      positions: mc?.current.positions.size ?? 0, totalValue: mc?.current.totalEquityValue ?? 0,
      concentration: mc ? concentration(mc.current) : null,
      counts: { new: mc?.changes.filter((c) => c.kind === 'new').length ?? 0, increased: mc?.changes.filter((c) => c.kind === 'increased').length ?? 0, reduced: mc?.changes.filter((c) => c.kind === 'reduced').length ?? 0, exited: mc?.changes.filter((c) => c.kind === 'exited').length ?? 0 },
      sectors: Object.entries(sectors).sort((a, b) => b[1] - a[1]).map(([sector, weight]) => ({ sector, weight })),
      holdings: mc ? [...mc.current.positions.values()].map((p) => ({ cusip: p.cusip, ticker: p.ticker, name: p.name, weight: mc.current.totalEquityValue ? p.value / mc.current.totalEquityValue : 0 })) : [],
      changes: mc?.changes.filter((c) => c.kind !== 'unchanged') ?? [],
    };
  }).filter((s): s is NonNullable<typeof s> => !!s);
  const sets = sides.map((s) => new Set(s.holdings.map((h) => h.cusip)));
  const overlap = sides.length >= 2 ? [...sets[0]].filter((c) => sets.every((s) => s.has(c))) : [];
  const overlapRows = overlap.map((cusip) => ({
    cusip,
    ticker: sides[0].holdings.find((h) => h.cusip === cusip)?.ticker ?? null,
    name: sides[0].holdings.find((h) => h.cusip === cusip)!.name,
    weights: sides.map((s) => s.holdings.find((h) => h.cusip === cusip)!.weight),
  })).sort((a, b) => Math.min(...b.weights) - Math.min(...a.weights));
  const periodsDiffer = new Set(sides.map((s) => s.period)).size > 1;
  return { sides: sides.map(({ holdings, ...rest }) => rest), overlap: overlapRows, periodsDiffer, comparablePeriod: cp.period };
}

export async function compareStocks(ctx: Ctx, issuers: EntityRow[]) {
  const profiles = await Promise.all(issuers.map((i) => stockProfile(ctx, i)));
  return {
    sides: profiles.map((p) => ({
      issuer: p.issuer,
      period: p.period,
      breadth: p.breadth,
      insider: p.insider.summary,
      insiderBuyValue: p.insider.transactions.filter(isQualifyingOpenMarketPurchase).reduce((s, t) => s + (t.value ?? 0), 0),
      events: p.events.slice(0, 5).map((e) => ({ formType: e.formType, headline: e.headline, acceptedAt: e.acceptedAt, accession: e.accession })),
      fundamentals: p.fundamentals.latest,
      market: { quote: p.market.quote, context: p.market.context, provider: p.market.provider, freshness: p.market.freshness },
      valuation: (() => {
        const eps = p.fundamentals.series.filter((f) => f.concept === 'EarningsPerShareDiluted').slice(0, 4);
        const ttmEps = eps.length === 4 ? eps.reduce((s, f) => s + f.value, 0) : null;
        const price = p.market.quote?.price ?? null;
        return {
          ttmEps,
          pe: ttmEps && price && ttmEps > 0 ? price / ttmEps : null,
          note: price == null ? 'Valuation requires market data.' : ttmEps == null ? 'Requires four quarters of reported EPS.' : 'P/E = latest close ÷ sum of last four reported diluted EPS.',
          isDemo: !!p.market.quote?.isDemo || p.issuer.origin === 'demo',
        };
      })(),
    })),
  };
}
