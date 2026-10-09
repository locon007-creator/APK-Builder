import { Link } from 'react-router-dom';
import { useApi } from '../api.ts';
import type { FilingRef, RadarCandidate, WatchItem } from '../../shared/types.ts';
import { EmptyState, ErrorState, FreshnessBadge, Loading, StaleNotice } from '../components/ui.tsx';
import { RadarCard } from '../components/RadarCard.tsx';
import { Icon, type IconName } from '../icons.tsx';
import { ago, date } from '../format.ts';

interface HomeData {
  since: string;
  firstVisit: boolean;
  sinceLastVisit: FilingRef[];
  radarHighlights: RadarCandidate[];
  watchlist: { items: WatchItem[]; activity: FilingRef[]; unreadAlerts: number };
  recentlyFiled: FilingRef[];
  period: string | null;
}

const SHORTCUTS: { to: string; label: string; icon: IconName; sub: string }[] = [
  { to: '/radar?mode=event&category=insider_buying', label: 'Insider buying', icon: 'users', sub: 'Open-market purchases' },
  { to: '/radar?mode=positioning&category=broad_interest', label: 'Broad interest', icon: 'layers', sub: 'Many managers adding' },
  { to: '/explore?preset=new_positions', label: 'New positions', icon: 'plus', sub: 'Latest 13F quarter' },
  { to: '/radar?mode=event&category=activist', label: 'Activist filings', icon: 'flask', sub: 'Schedule 13D' },
  { to: '/radar?mode=event&category=corporate_events', label: 'Event watch', icon: 'bell', sub: 'Material 8-Ks' },
  { to: '/compare', label: 'Compare', icon: 'compare', sub: 'Investors or stocks' },
];

export function FilingRow({ f }: { f: FilingRef }) {
  const who = f.subjectName && f.subjectCik !== f.filerCik ? `${f.filerName ?? f.filerCik} → ${f.subjectName}` : (f.filerName ?? f.filerCik);
  return (
    <li>
      <Link className="row-link" to={`/filings/${f.accession}`}>
        <span className="ticker-chip" aria-hidden="true">{f.baseForm === '13F-HR' ? '13F' : f.baseForm.replace('SC ', '')}</span>
        <span className="grow">
          <span className="title">{who}</span>
          <span className="meta">
            <span>{f.formType}{f.isAmendment && f.amendmentType ? ` · ${f.amendmentType.toLowerCase()}` : ''}</span>
            {f.periodOfReport && f.baseForm === '13F-HR' && <span>Period {date(f.periodOfReport)}</span>}
            <span>Accepted {ago(f.acceptedAt)}</span>
          </span>
        </span>
        <span className="right"><FreshnessBadge f={f.freshness} /></span>
      </Link>
    </li>
  );
}

export function HomePage() {
  const { data, error, loading, reload, stale } = useApi<HomeData>('/api/home');
  if (loading && !data) return <><div className="page-head"><h1>Today’s research</h1></div><Loading lines={4} /></>;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const sinceLabel = data.firstVisit ? 'in the last 7 days' : `since ${ago(data.since)}`;
  return (
    <>
      <StaleNotice show={stale} />
      <div className="page-head">
        <h1>Today’s research</h1>
        <p className="muted">What’s new, what may matter, and the evidence behind it.</p>
      </div>

      <section className="section" aria-labelledby="h-since" style={{ marginTop: 6 }}>
        <div className="section-head"><h2 id="h-since">{data.firstVisit ? 'Recently accepted' : 'Since your last visit'}</h2><span className="subtle">{data.sinceLastVisit.length} filing{data.sinceLastVisit.length === 1 ? '' : 's'} {sinceLabel}</span></div>
        {data.sinceLastVisit.length ? (
          <div className="card"><ul className="list">{data.sinceLastVisit.slice(0, 5).map((f) => <FilingRow key={f.accession} f={f} />)}</ul>
            {data.sinceLastVisit.length > 5 && <div className="card-pad" style={{ paddingTop: 0 }}><Link className="link" to="/filings">See all {data.sinceLastVisit.length}</Link></div>}
          </div>
        ) : <EmptyState icon="check" title="You’re up to date">No new filings have been accepted {sinceLabel}.</EmptyState>}
      </section>

      <section className="section" aria-labelledby="h-radar">
        <div className="section-head"><h2 id="h-radar">Radar highlights</h2><Link to="/radar">Open Radar</Link></div>
        {data.radarHighlights.length ? (
          <div className="stack">{data.radarHighlights.slice(0, 4).map((c) => <RadarCard key={c.id} c={c} />)}</div>
        ) : <EmptyState icon="radar" title="No candidates yet">Radar candidates appear once filings have been ingested.</EmptyState>}
      </section>

      <div className="grid-2">
        <section className="section stack" aria-labelledby="h-watch" style={{ gap: 0 }}>
          <div className="section-head"><h2 id="h-watch">Watchlist activity</h2><Link to="/watchlist">Manage</Link></div>
          {data.watchlist.items.length === 0 ? (
            <EmptyState icon="bookmark" title="Follow stocks and investors" action={<Link className="btn small" to="/stocks">Browse stocks</Link>}>New filings for what you follow will appear here.</EmptyState>
          ) : data.watchlist.activity.length ? (
            <div className="card"><ul className="list">{data.watchlist.activity.slice(0, 6).map((f) => <FilingRow key={f.accession} f={f} />)}</ul></div>
          ) : <EmptyState icon="check" title="Quiet on your watchlist">No filings in the last 30 days for the {data.watchlist.items.length} item(s) you follow.</EmptyState>}
          {data.watchlist.unreadAlerts > 0 && <Link to="/watchlist?tab=alerts" className="banner info" style={{ marginTop: 10, textDecoration: 'none' }}><Icon name="bell" size={18} /><span>{data.watchlist.unreadAlerts} unread alert{data.watchlist.unreadAlerts === 1 ? '' : 's'}</span></Link>}
        </section>

        <section className="section stack" aria-labelledby="h-recent" style={{ gap: 0 }}>
          <div className="section-head"><h2 id="h-recent">Recently filed</h2><span className="subtle">by EDGAR acceptance</span></div>
          <div className="card"><ul className="list">{data.recentlyFiled.slice(0, 6).map((f) => <FilingRow key={f.accession} f={f} />)}</ul></div>
        </section>
      </div>

      <section className="section" aria-labelledby="h-short">
        <div className="section-head"><h2 id="h-short">Research shortcuts</h2></div>
        <div className="card"><ul className="list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {SHORTCUTS.map((s) => (
            <li key={s.to} style={{ borderTop: '1px solid var(--line)' }}>
              <Link className="row-link" to={s.to}><span className="ticker-chip" aria-hidden="true"><Icon name={s.icon} size={18} /></span><span className="grow"><span className="title">{s.label}</span><span className="meta">{s.sub}</span></span><Icon name="chevronRight" size={18} /></Link>
            </li>
          ))}
        </ul></div>
      </section>
    </>
  );
}
