import type { DB } from '../db/index.ts';
import type { DataOrigin, Evidence } from '../../shared/types.ts';
import { allManagerChanges, comparablePeriod } from './thirteenF.ts';
import { getEntity, listEvents, listFilings, listInsiderTransactions } from './queries.ts';
import { isQualifyingOpenMarketPurchase } from './form4Codes.ts';
import { eventRelevance } from './events8k.ts';
import { dedupeEvents } from './radar.ts';

export const PRESETS = {
  new_positions: { label: 'New institutional positions', rule: 'Holding reported by a tracked manager in the comparable quarter that was absent from its prior 13F.' },
  broad_adds: { label: 'Broad-based reported adds', rule: 'Stocks ranked by the number of tracked managers that increased or initiated, minus those that reduced or exited.' },
  largest_share_increases: { label: 'Largest share-count increases', rule: 'Existing positions ranked by percentage increase in reported shares (price effects excluded).' },
  largest_weight_increases: { label: 'Largest portfolio-weight increases', rule: 'Positions ranked by change in derived portfolio weight (value ÷ total reported equity value). Weight can rise from price alone.' },
  recent_insider_purchases: { label: 'Recent insider purchases', rule: 'Form 4 code P, non-derivative, priced, not under a 10b5-1 plan, transaction within 90 days.' },
  institutional_reductions: { label: 'Institutional reductions', rule: 'Positions with lower reported share counts, or exits, in the comparable quarter.' },
  activist: { label: 'Recent activist disclosures', rule: 'Schedule 13D and 13D/A filings accepted within 180 days.' },
  corporate_events: { label: 'Corporate event watch', rule: '8-K filings within 30 days with an item relevance of at least 0.6 (8-K/A merged with originals).' },
  watchlist: { label: 'Watchlist developments', rule: 'All filings for followed stocks and managers within 30 days.' },
} as const;
export type Preset = keyof typeof PRESETS;

export interface ExploreRow {
  id: string;
  title: string;
  subtitle: string;
  metric: string;
  metricLabel: string;
  sortValue: number;
  date: string;          // the date used for "newest" sorting (acceptance)
  periodOfReport: string | null;
  eventDate: string | null;
  qualifiedBecause: string;
  link: string;
  sector: string | null;
  evidence: Evidence[];
  origin: DataOrigin;
}

const pct = (x: number | null) => (x == null ? 'n/a' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`);
const usd = (x: number) => (Math.abs(x) >= 1e9 ? `$${(x / 1e9).toFixed(2)}B` : Math.abs(x) >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x).toLocaleString('en-US')}`);

export function explore(db: DB, preset: Preset, asOf: string, watch: { stocks: Set<string>; managers: Set<string> }): { rows: ExploreRow[]; period: string | null } {
  const { period } = comparablePeriod(db, asOf);
  const changes = () => (period ? allManagerChanges(db, period, asOf).flatMap((m) => m.changes) : []);
  const sectorOf = (cik: string | null) => (cik ? getEntity(db, cik)?.sector ?? null : null);
  const stockLink = (ticker: string | null, cik: string | null) => `/stocks/${encodeURIComponent(ticker ?? cik ?? '')}`;
  const chgEvidence = (c: ReturnType<typeof changes>[number]): Evidence => ({
    kind: 'position_change', summary: `${c.managerName}: ${c.sharesPrior.toLocaleString('en-US')} → ${c.sharesCurrent.toLocaleString('en-US')} shares (${c.priorPeriod} → ${c.period})`,
    accession: c.filingAccession, acceptedAt: c.filingAcceptedAt, periodOfReport: c.period, eventDate: null, sourceUrl: null, origin: c.origin,
  });

  let rows: ExploreRow[] = [];
  switch (preset) {
    case 'new_positions':
    case 'largest_share_increases':
    case 'largest_weight_increases':
    case 'institutional_reductions': {
      const filtered = changes().filter((c) =>
        preset === 'new_positions' ? c.kind === 'new'
          : preset === 'largest_share_increases' ? c.kind === 'increased'
            : preset === 'largest_weight_increases' ? (c.weightChange ?? 0) > 0 && c.kind !== 'exited'
              : c.kind === 'reduced' || c.kind === 'exited');
      rows = filtered.map((c) => {
        const metric = preset === 'new_positions' ? (c.weightCurrent ?? 0)
          : preset === 'largest_share_increases' ? (c.shareChangePct ?? 0)
            : preset === 'largest_weight_increases' ? (c.weightChange ?? 0)
              : c.kind === 'exited' ? -1 : (c.shareChangePct ?? 0);
        return {
          id: `${preset}:${c.managerCik}:${c.cusip}`,
          title: `${c.ticker ?? c.cusip} · ${c.issuerName}`,
          subtitle: `${c.managerName} · ${c.kind}`,
          metric: preset === 'new_positions' ? `${((c.weightCurrent ?? 0) * 100).toFixed(2)}%` : preset === 'largest_weight_increases' ? `${((c.weightChange ?? 0) * 100).toFixed(2)} pp` : c.kind === 'exited' ? 'Exited' : pct(c.shareChangePct),
          metricLabel: preset === 'new_positions' ? 'of reported equity' : preset === 'largest_weight_increases' ? 'weight change' : 'share-count change',
          sortValue: preset === 'institutional_reductions' ? -metric : metric,
          date: c.filingAcceptedAt,
          periodOfReport: c.period,
          eventDate: null,
          qualifiedBecause: preset === 'largest_weight_increases'
            ? `Weight ${((c.weightPrior ?? 0) * 100).toFixed(2)}% → ${((c.weightCurrent ?? 0) * 100).toFixed(2)}%; shares ${pct(c.shareChangePct)}; price effect ${usd(c.valueChangeFromPrice)} of ${usd(c.valueChange)} value change.`
            : `${c.managerName} reported ${c.sharesPrior.toLocaleString('en-US')} → ${c.sharesCurrent.toLocaleString('en-US')} shares between ${c.priorPeriod} and ${c.period}.`,
          link: c.issuerCik ? stockLink(c.ticker, c.issuerCik) : `/investors/${c.managerCik}`,
          sector: sectorOf(c.issuerCik),
          evidence: [chgEvidence(c)],
          origin: c.origin,
        };
      });
      break;
    }
    case 'broad_adds': {
      const by = new Map<string, ReturnType<typeof changes>>();
      for (const c of changes()) if (c.issuerCik) (by.get(c.issuerCik) ?? by.set(c.issuerCik, []).get(c.issuerCik)!).push(c);
      rows = [...by.entries()].map(([cik, cs]) => {
        const adds = cs.filter((c) => c.kind === 'new' || c.kind === 'increased');
        const cuts = cs.filter((c) => c.kind === 'reduced' || c.kind === 'exited');
        const e = getEntity(db, cik)!;
        return {
          id: `broad:${cik}`, title: `${e.ticker ?? cik} · ${e.name}`, subtitle: `${adds.length} added · ${cuts.length} reduced`,
          metric: `${adds.length - cuts.length >= 0 ? '+' : ''}${adds.length - cuts.length}`, metricLabel: 'net managers adding',
          sortValue: adds.length - cuts.length + adds.length / 100, date: cs.map((c) => c.filingAcceptedAt).sort().at(-1)!, periodOfReport: period, eventDate: null,
          qualifiedBecause: `In ${period}: added by ${adds.map((c) => c.managerName).join(', ') || 'none'}; reduced by ${cuts.map((c) => c.managerName).join(', ') || 'none'}.`,
          link: stockLink(e.ticker, cik), sector: e.sector, evidence: [...adds, ...cuts].map(chgEvidence), origin: e.origin,
        };
      }).filter((r) => r.sortValue > 0);
      break;
    }
    case 'recent_insider_purchases': {
      rows = listInsiderTransactions(db, { asOf, sinceDays: 90 }).filter(isQualifyingOpenMarketPurchase).map((t) => ({
        id: `p:${t.id}`, title: `${t.ticker ?? t.issuerCik} · ${t.issuerName}`, subtitle: `${t.ownerName} · ${t.ownerRole}`,
        metric: usd(t.value ?? 0), metricLabel: `${t.shares.toLocaleString('en-US')} sh @ $${t.price?.toFixed(2)}`, sortValue: t.value ?? 0,
        date: t.acceptedAt, periodOfReport: null, eventDate: t.transactionDate,
        qualifiedBecause: `Form 4 code P (${t.codeLabel}), non-derivative, ${t.directOrIndirect === 'D' ? 'direct' : 'indirect'} ownership, transaction ${t.transactionDate}.`,
        link: stockLink(t.ticker, t.issuerCik), sector: sectorOf(t.issuerCik),
        evidence: [{ kind: 'insider_transaction', summary: `${t.ownerName} bought ${t.shares.toLocaleString('en-US')} sh`, accession: t.accession, acceptedAt: t.acceptedAt, periodOfReport: null, eventDate: t.transactionDate, sourceUrl: t.sourceUrl, origin: t.origin }],
        origin: t.origin,
      }));
      break;
    }
    case 'activist':
    case 'corporate_events': {
      const evs = preset === 'activist' ? listEvents(db, { asOf, sinceDays: 180, forms: ['SC 13D'] }) : dedupeEvents(listEvents(db, { asOf, sinceDays: 30, forms: ['8-K'] })).filter((e) => eventRelevance(e.items.map((i) => i.code)) >= 0.6);
      rows = evs.map((e) => {
        const rel = eventRelevance(e.items.map((i) => i.code));
        return {
          id: `${preset}:${e.accession}`, title: `${e.ticker ?? e.issuerCik} · ${e.issuerName}`, subtitle: `${e.formType} · ${e.headline}`,
          metric: preset === 'activist' ? (e.percentOfClass != null ? `${e.percentOfClass.toFixed(1)}%` : 'n/a') : rel.toFixed(2),
          metricLabel: preset === 'activist' ? 'of class' : 'item relevance',
          sortValue: preset === 'activist' ? e.percentOfClass ?? 0 : rel, date: e.acceptedAt, periodOfReport: null, eventDate: e.eventDate,
          qualifiedBecause: preset === 'activist' ? `${e.filerName ?? 'Filer'} filed ${e.formType}${e.percentOfClass != null ? ` reporting ${e.percentOfClass}% of the class` : ''}.` : `Items: ${e.items.map((i) => `${i.code} ${i.label} (${i.relevance})`).join('; ')}.`,
          link: stockLink(e.ticker, e.issuerCik), sector: sectorOf(e.issuerCik),
          evidence: [{ kind: 'event', summary: e.headline, accession: e.accession, acceptedAt: e.acceptedAt, periodOfReport: null, eventDate: e.eventDate, sourceUrl: e.sourceUrl, origin: e.origin }],
          origin: e.origin,
        };
      });
      break;
    }
    case 'watchlist': {
      const ciks = [...watch.stocks, ...watch.managers];
      rows = ciks.flatMap((cik) => listFilings(db, { asOf, now: asOf, cik, since: new Date(new Date(asOf).getTime() - 30 * 86_400_000).toISOString(), limit: 25 })).map((f) => {
        const subject = f.subjectCik ? getEntity(db, f.subjectCik) : null;
        return {
          id: `w:${f.accession}`, title: `${f.formType} · ${f.subjectName ?? f.filerName ?? f.filerCik}`, subtitle: f.filerName ?? f.filerCik,
          metric: f.acceptedAt.slice(0, 10), metricLabel: 'accepted', sortValue: Date.parse(f.acceptedAt), date: f.acceptedAt, periodOfReport: f.periodOfReport, eventDate: null,
          qualifiedBecause: `Filed by or about an item on your watchlist.`, link: `/filings/${f.accession}`, sector: subject?.sector ?? null,
          evidence: [{ kind: 'filing', summary: `${f.formType} accepted ${f.acceptedAt}`, accession: f.accession, acceptedAt: f.acceptedAt, periodOfReport: f.periodOfReport, eventDate: null, sourceUrl: f.sourceUrl, origin: f.origin }],
          origin: f.origin,
        };
      });
      const seen = new Set<string>();
      rows = rows.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
      break;
    }
  }
  return { rows, period };
}
