import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import type { DataOrigin, Evidence } from '../../shared/types.ts';
import { Disclosure, EmptyState, ErrorState, Loading, OriginBadge, SourceLink, StaleNotice, Times } from '../components/ui.tsx';
import { PRESET_LABELS } from '../labels.ts';
import { Icon } from '../icons.tsx';
import { date } from '../format.ts';

interface Row { id: string; title: string; subtitle: string; metric: string; metricLabel: string; date: string; periodOfReport: string | null; eventDate: string | null; qualifiedBecause: string; link: string; sector: string | null; evidence: Evidence[]; origin: DataOrigin }
interface ExploreData { preset: string; rule: string; label: string; period: string | null; total: number; page: number; pages: number; rows: Row[]; sectors: string[] }

export function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const preset = params.get('preset') ?? 'new_positions';
  const sort = params.get('sort') ?? 'metric';
  const sector = params.get('sector') ?? '';
  const page = Number(params.get('page') ?? 1);
  const [q, setQ] = useState(params.get('q') ?? '');
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (!v) next.delete(k); else next.set(k, v); }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => { if ((params.get('q') ?? '') !== q) set({ q }); }, 300);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const qs = new URLSearchParams({ preset, sort, page: String(page), pageSize: '15' });
  if (sector) qs.set('sector', sector);
  if (params.get('q')) qs.set('q', params.get('q')!);
  const { data, error, loading, reload, stale } = useApi<ExploreData>(`/api/explore?${qs}`);

  return (
    <>
      <StaleNotice show={stale} />
      <div className="page-head"><h1>Explore</h1><p className="muted">Searchable research screens with the rule each result had to meet.</p></div>
      <div className="chips" role="group" aria-label="Research presets">
        {Object.entries(PRESET_LABELS).map(([k, label]) => <button key={k} className="chip" aria-pressed={preset === k} onClick={() => set({ preset: k, sector: null })}>{label}</button>)}
      </div>

      <div className="toolbar" style={{ marginTop: 6 }}>
        <div className="grow field"><label htmlFor="ex-q" className="sr-only">Filter results</label>
          <input id="ex-q" className="input" type="search" placeholder="Filter by name, ticker or investor" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="sr-only" htmlFor="ex-sector">Sector</label>
        <select id="ex-sector" className="input" style={{ width: 'auto', flex: '1 1 140px' }} value={sector} onChange={(e) => set({ sector: e.target.value })}>
          <option value="">All sectors</option>{data?.sectors.map((s) => <option key={s}>{s}</option>)}
        </select>
        <label className="sr-only" htmlFor="ex-sort">Sort</label>
        <select id="ex-sort" className="input" style={{ width: 'auto', flex: '1 1 140px' }} value={sort} onChange={(e) => set({ sort: e.target.value })}>
          <option value="metric">Sort: strongest</option><option value="newest">Sort: newest filing</option><option value="name">Sort: name</option>
        </select>
      </div>

      {data && <div className="banner info" role="note"><Icon name="info" size={18} /><span><strong>{data.label}.</strong> {data.rule}{data.period ? ` Comparable quarter: ${date(data.period)}.` : ''}</span></div>}

      {loading && !data ? <Loading lines={5} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data || data.rows.length === 0 ? (
        <EmptyState icon="search" title="No results" action={preset === 'watchlist' ? <Link className="btn small" to="/stocks">Follow stocks</Link> : undefined}>
          {preset === 'watchlist' ? 'Follow stocks or investors to see their filings here.' : 'Nothing matches this screen with the current filters.'}
        </EmptyState>
      ) : (
        <>
          <p className="subtle" style={{ marginBottom: 8 }} aria-live="polite">{data.total} result{data.total === 1 ? '' : 's'} · page {data.page} of {data.pages}</p>
          <div className="stack">
            {data.rows.map((r) => (
              <article key={r.id} className="card" style={{ padding: '12px 14px' }}>
                <div className="split" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ overflowWrap: 'anywhere' }}><Link to={r.link} style={{ textDecoration: 'none' }}>{r.title}</Link></h3>
                    <p className="subtle">{r.subtitle}</p>
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}><div className="num" style={{ fontWeight: 700, fontSize: '1.05rem' }}>{r.metric}</div><div className="subtle">{r.metricLabel}</div></div>
                </div>
                <div className="split" style={{ marginTop: 8 }}>
                  <Times period={r.periodOfReport} event={r.eventDate} accepted={r.date} />
                  <OriginBadge origin={r.origin} />
                </div>
                <div style={{ margin: '10px -14px -12px' }}>
                  <Disclosure label="Why it qualified">
                    <p>{r.qualifiedBecause}</p>
                    <ul className="evidence">
                      {r.evidence.map((e, i) => (
                        <li key={i}><span>{e.summary}</span><Times period={e.periodOfReport} event={e.eventDate} accepted={e.acceptedAt} />
                          <div className="split">{e.accession ? <Link className="link" to={`/filings/${e.accession}`}>Filing record</Link> : <span />}<SourceLink url={e.sourceUrl} accession={null} origin={e.origin} /></div>
                        </li>
                      ))}
                    </ul>
                  </Disclosure>
                </div>
              </article>
            ))}
          </div>
          <nav className="pager" aria-label="Pagination">
            <button className="btn small" disabled={data.page <= 1} onClick={() => set({ page: String(data.page - 1) })}><Icon name="chevronLeft" size={16} />Previous</button>
            <span className="subtle">{data.page} / {data.pages}</span>
            <button className="btn small" disabled={data.page >= data.pages} onClick={() => set({ page: String(data.page + 1) })}>Next<Icon name="chevronRight" size={16} /></button>
          </nav>
        </>
      )}
    </>
  );
}
