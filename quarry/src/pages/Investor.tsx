import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import type { FilingRef, Freshness, PositionChange } from '../../shared/types.ts';
import { EmptyState, ErrorState, FreshnessBadge, KindBadge, Kpi, Loading, OriginBadge, StaleNotice, Tabs, Times } from '../components/ui.tsx';
import { WatchButton } from '../components/WatchButton.tsx';
import { FilingRow } from './Home.tsx';
import { date, pct, shares, usd } from '../format.ts';

interface InvestorListItem { cik: string; name: string; origin: 'sec' | 'demo'; latestPeriod: string | null; acceptedAt: string | null; positions: number; totalValue: number; freshness: Freshness }

export function InvestorsPage() {
  const { data, error, loading, reload } = useApi<{ investors: InvestorListItem[] }>('/api/investors');
  return (
    <>
      <div className="page-head"><h1>Investors</h1><p className="muted">Tracked investment managers and their latest reported 13F holdings.</p></div>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data?.investors.length ? <EmptyState title="No tracked investors">Add managers to the tracked universe and run ingestion.</EmptyState> : (
        <div className="card"><ul className="list">
          {data.investors.map((i) => (
            <li key={i.cik}><Link className="row-link" to={`/investors/${i.cik}`}>
              <span className="grow"><span className="title">{i.name}</span>
                <span className="meta"><span>CIK {i.cik}</span><span>{i.positions} positions</span><span>{usd(i.totalValue)}</span><span>Period {date(i.latestPeriod)}</span></span></span>
              <span className="right"><FreshnessBadge f={i.freshness} /></span>
            </Link></li>
          ))}
        </ul></div>
      )}
    </>
  );
}

interface Profile {
  manager: { cik: string; name: string; origin: 'sec' | 'demo' };
  periods: string[];
  period: string | null;
  priorPeriod: string | null;
  filing: { accessions: string[]; acceptedAt: string; amendments: { accession: string; type: string; acceptedAt: string }[]; optionRows: { cusip: string; name: string; putCall: string; shares: number; value: number }[]; principalRows: number } | null;
  freshness: Freshness;
  totals: { totalValue: number; priorTotalValue: number | null; positions: number } | null;
  summary: Record<'new' | 'increased' | 'reduced' | 'exited' | 'unchanged', number>;
  concentration: { positions: number; top10Weight: number; hhi: number; largestWeight: number } | null;
  changes: PositionChange[];
  history: { period: string; acceptedAt: string; accessions: string[]; amendments: { accession: string; type: string }[]; positions: number; totalValue: number; concentration: { top10Weight: number } }[];
  positionHistory: { cusip: string; ticker: string | null; issuerName: string; issuerCik: string | null; points: { period: string; shares: number; value: number }[] }[];
  filings: FilingRef[];
  notes: string[];
}

type Tab = 'changes' | 'holdings' | 'history' | 'filings';

export function InvestorPage() {
  const { cik = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const period = params.get('period');
  const tab = (params.get('tab') as Tab) || 'changes';
  const [kind, setKind] = useState<string>('all');
  const { data, error, loading, reload, stale } = useApi<Profile>(`/api/investors/${cik}${period ? `?period=${period}` : ''}`);
  const setP = (patch: Record<string, string>) => setParams({ ...Object.fromEntries(params), ...patch }, { replace: true });

  if (loading && !data) return <Loading lines={5} />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const m = data.manager;
  const changes = data.changes.filter((c) => (kind === 'all' ? c.kind !== 'unchanged' : c.kind === kind));
  const holdings = data.changes.filter((c) => c.sharesCurrent > 0).sort((a, b) => (b.weightCurrent ?? 0) - (a.weightCurrent ?? 0));

  return (
    <>
      <StaleNotice show={stale} />
      <div className="page-head">
        <div className="badges">{data.freshness.status !== "demo" && <OriginBadge origin={m.origin} />}<FreshnessBadge f={data.freshness} /></div>
        <h1 style={{ marginTop: 6 }}>{m.name}</h1>
        <p className="subtle">SEC CIK <span className="mono">{m.cik}</span> · Form 13F filer</p>
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          <WatchButton kind="manager" id={m.cik} label={m.name} />
          <Link className="btn small" to={`/compare?type=investors&ids=${m.cik}`}>Compare</Link>
        </div>
      </div>

      {!data.period ? <EmptyState title="No 13F filings available">No holdings report was accepted on or before the selected cutoff.</EmptyState> : (
        <>
          <div className="card card-pad">
            <div className="field"><label htmlFor="inv-period">Reporting period</label>
              <select id="inv-period" className="input" value={data.period} onChange={(e) => setP({ period: e.target.value })}>
                {data.periods.map((p) => <option key={p} value={p}>Quarter ended {date(p)}</option>)}
              </select>
            </div>
            <div style={{ marginTop: 10 }}><Times period={data.period} accepted={data.filing?.acceptedAt} /></div>
            <p className="subtle" style={{ marginTop: 6 }}>Compared with {data.priorPeriod ? `quarter ended ${date(data.priorPeriod)}` : 'no prior filing (changes cannot be classified)'}.</p>
            {data.filing?.amendments.length ? <p className="subtle" style={{ marginTop: 6 }}>Includes {data.filing.amendments.map((a) => `${a.type.toLowerCase()} amendment accepted ${date(a.acceptedAt)}`).join('; ')}.</p> : null}
          </div>

          <div className="kpis" style={{ marginTop: 12 }}>
            <Kpi k="Reported value" v={usd(data.totals?.totalValue)} s={data.totals?.priorTotalValue != null ? `prior ${usd(data.totals.priorTotalValue)}` : undefined} />
            <Kpi k="Positions" v={data.totals?.positions ?? 0} s={`${data.summary.new} new · ${data.summary.exited} exited`} />
            <Kpi k="Adds / cuts" v={<><span className="pos">{data.summary.increased}</span> / <span className="neg">{data.summary.reduced}</span></>} s="share-count based" />
            <Kpi k="Top-10 weight" v={pct(data.concentration?.top10Weight)} s={`largest ${pct(data.concentration?.largestWeight)} (derived)`} />
          </div>

          <Tabs label="Investor sections" value={tab} onChange={(t) => setP({ tab: t })}
            tabs={[{ value: 'changes', label: 'Changes' }, { value: 'holdings', label: 'Holdings' }, { value: 'history', label: 'History' }, { value: 'filings', label: 'Filings' }]} />

          {tab === 'changes' && (
            <>
              <div className="chips" role="group" aria-label="Change type">
                {(['all', 'new', 'increased', 'reduced', 'exited'] as const).map((k) => (
                  <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{k === 'all' ? 'All changes' : k[0].toUpperCase() + k.slice(1)} <span className="count">{k === 'all' ? data.changes.filter((c) => c.kind !== 'unchanged').length : data.summary[k]}</span></button>
                ))}
              </div>
              {!changes.length ? <EmptyState title="No changes of this type" /> : <div className="stack">{changes.map((c) => <ChangeCard key={c.cusip} c={c} />)}</div>}
            </>
          )}

          {tab === 'holdings' && (
            <div className="card"><ul className="list">
              {holdings.map((c) => (
                <li key={c.cusip}>
                  <Link className="row-link" to={c.issuerCik ? `/stocks/${c.ticker ?? c.issuerCik}` : '#'}>
                    <span className="ticker-chip">{c.ticker ?? '—'}</span>
                    <span className="grow"><span className="title">{c.issuerName}</span><span className="meta"><span>{shares(c.sharesCurrent)} sh</span><span>{usd(c.valueCurrent)}</span><span className="mono">{c.cusip}</span></span></span>
                    <span className="right"><b className="num">{pct(c.weightCurrent)}</b><div className="subtle">weight</div></span>
                  </Link>
                </li>
              ))}
              {data.filing && data.filing.optionRows.length > 0 && (
                <li className="card-pad subtle">{data.filing.optionRows.length} option row(s) (puts/calls) reported separately and excluded from share counts and weights: {data.filing.optionRows.map((o) => `${o.name} ${o.putCall} (${shares(o.shares)} underlying)`).join('; ')}.</li>
              )}
            </ul></div>
          )}

          {tab === 'history' && (
            <div className="stack">
              <div className="card"><div className="scroll-x" style={{ margin: 0, padding: '0 14px' }}>
                <table className="mini-table">
                  <caption className="sr-only">Reported totals by period</caption>
                  <thead><tr><th>Period</th><th className="r">Value</th><th className="r">Positions</th><th className="r">Top-10</th><th>Accepted</th></tr></thead>
                  <tbody>{data.history.map((h) => (
                    <tr key={h.period}><td>{date(h.period)}{h.amendments.length ? <span className="badge neutral" style={{ marginLeft: 6 }}>amended</span> : null}</td><td className="r num">{usd(h.totalValue)}</td><td className="r num">{h.positions}</td><td className="r num">{pct(h.concentration.top10Weight)}</td><td className="subtle">{date(h.acceptedAt)}</td></tr>
                  ))}</tbody>
                </table>
              </div></div>
              <h2>Share-count history · current top positions</h2>
              <p className="subtle">Reported quarter-end share counts. These are not trade dates or execution prices.</p>
              {data.positionHistory.map((p) => (
                <div key={p.cusip} className="card card-pad">
                  <div className="split"><h3>{p.ticker ?? p.cusip} <span className="subtle" style={{ fontWeight: 500 }}>{p.issuerName}</span></h3></div>
                  <ShareBars points={p.points} />
                </div>
              ))}
            </div>
          )}

          {tab === 'filings' && <div className="card"><ul className="list">{data.filings.map((f) => <FilingRow key={f.accession} f={f} />)}</ul></div>}

          <ul className="subtle" style={{ marginTop: 16, paddingLeft: 18 }}>{data.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
    </>
  );
}

function ShareBars({ points }: { points: { period: string; shares: number }[] }) {
  const max = Math.max(...points.map((p) => p.shares), 1);
  return (
    <div role="img" aria-label={points.map((p) => `${date(p.period)}: ${shares(p.shares)} shares`).join('; ')} style={{ display: 'grid', gridTemplateColumns: `repeat(${points.length}, 1fr)`, gap: 6, alignItems: 'end', height: 92, marginTop: 10 }}>
      {points.map((p) => (
        <div key={p.period} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
          <span className="subtle num" style={{ fontSize: '0.68rem' }}>{shares(p.shares)}</span>
          <div style={{ width: '100%', maxWidth: 36, height: `${Math.max(2, (p.shares / max) * 56)}px`, background: p.shares ? 'var(--brand)' : 'var(--line)', borderRadius: 4 }} />
          <span className="subtle" style={{ fontSize: '0.66rem' }}>{p.period.slice(2, 7)}</span>
        </div>
      ))}
    </div>
  );
}

export function ChangeCard({ c, showManager = false }: { c: PositionChange; showManager?: boolean }) {
  return (
    <article className="card card-pad">
      <div className="split" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="badges"><KindBadge kind={c.kind} /></div>
          <h3 style={{ marginTop: 6 }}>
            {showManager ? <Link to={`/investors/${c.managerCik}`} style={{ textDecoration: 'none' }}>{c.managerName}</Link>
              : c.issuerCik ? <Link to={`/stocks/${c.ticker ?? c.issuerCik}`} style={{ textDecoration: 'none' }}>{c.ticker ?? c.cusip} <span className="subtle" style={{ fontWeight: 500 }}>{c.issuerName}</span></Link>
                : <>{c.issuerName} <span className="badge unavailable">Unmapped CUSIP</span></>}
          </h3>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={`num ${c.shareChange > 0 ? 'pos' : c.shareChange < 0 ? 'neg' : ''}`} style={{ fontWeight: 700 }}>{c.kind === 'new' ? 'New' : c.kind === 'exited' ? 'Exited' : pct(c.shareChangePct, { sign: true })}</div>
          <div className="subtle">shares</div>
        </div>
      </div>
      <dl className="facts four" style={{ marginTop: 10 }}>
        <div><dt>Shares</dt><dd className="num">{shares(c.sharesPrior)} → {shares(c.sharesCurrent)}</dd></div>
        <div><dt>Value change</dt><dd className="num">{usd(c.valueChange, { sign: true })}</dd></div>
        <div><dt>From shares</dt><dd className="num">{usd(c.valueChangeFromShares, { sign: true })}</dd></div>
        <div><dt>From price</dt><dd className="num">{usd(c.valueChangeFromPrice, { sign: true })}</dd></div>
        <div><dt>Weight</dt><dd className="num">{pct(c.weightPrior, { digits: 2 })} → {pct(c.weightCurrent, { digits: 2 })}</dd></div>
        <div><dt>Periods</dt><dd>{c.priorPeriod ? date(c.priorPeriod) : '—'} → {date(c.period)}</dd></div>
      </dl>
      <div className="split" style={{ marginTop: 8 }}>
        <Times accepted={c.filingAcceptedAt} />
        <Link className="link" to={`/filings/${c.filingAccession}`}>Filing record</Link>
      </div>
    </article>
  );
}
