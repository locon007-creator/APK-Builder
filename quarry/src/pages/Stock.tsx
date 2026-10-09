import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import type { CorporateEvent, DataOrigin, Freshness, InsiderTransaction, PositionChange, PriceBar, ProviderStatus } from '../../shared/types.ts';
import { EmptyState, ErrorState, FreshnessBadge, KindBadge, Kpi, Loading, OriginBadge, SourceLink, StaleNotice, Tabs, Times } from '../components/ui.tsx';
import { WatchButton } from '../components/WatchButton.tsx';
import { PriceChart } from '../components/PriceChart.tsx';
import { ChangeCard } from './Investor.tsx';
import { Icon } from '../icons.tsx';
import { date, pct, shares, usd } from '../format.ts';

interface StockList { stocks: { cik: string; name: string; ticker: string | null; sector: string | null; marketCap: number | null; origin: DataOrigin }[] }

export function StocksPage() {
  const { data, error, loading, reload } = useApi<StockList>('/api/stocks');
  return (
    <>
      <div className="page-head"><h1>Stocks</h1><p className="muted">Tracked issuers with research pages.</p></div>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data?.stocks.length ? <EmptyState title="No tracked stocks" /> : (
        <div className="card"><ul className="list">
          {data.stocks.map((s) => (
            <li key={s.cik}><Link className="row-link" to={`/stocks/${s.ticker ?? s.cik}`}>
              <span className="ticker-chip">{s.ticker ?? '—'}</span>
              <span className="grow"><span className="title">{s.name}</span><span className="meta"><span>{s.sector ?? 'Sector n/a'}</span>{s.marketCap != null && <span>{usd(s.marketCap)} cap{s.origin === 'demo' ? ' (demo)' : ''}</span>}</span></span>
              <Icon name="chevronRight" size={18} />
            </Link></li>
          ))}
        </ul></div>
      )}
    </>
  );
}

interface StockData {
  issuer: { cik: string; name: string; ticker: string | null; sector: string | null; marketCap: number | null; marketCapAsOf: string | null; description: string | null; origin: DataOrigin };
  period: string | null;
  ownership: { holders: { managerCik: string; managerName: string; shares: number; value: number; weight: number | null; kind: string; accession: string; acceptedAt: string }[]; freshness: Freshness };
  changes: PositionChange[];
  breadth: { holders: number; new: number; increased: number; reduced: number; exited: number; unchanged: number; trackedManagers: number };
  insider: { transactions: InsiderTransaction[]; summary: { openMarketBuys: number; openMarketSales: number; other: number } };
  events: CorporateEvent[];
  market: {
    provider: ProviderStatus;
    quote: { price: number; asOf: string | null; delay: string; isDemo: boolean; provider: string } | null;
    context: { lastClose: number; sma50: number | null; trend: string; return5d: number | null; return20d: number | null; volumeZ: number | null; returnZ: number | null } | null;
    bars: PriceBar[];
    eventMoves: { accession: string; headline: string; eventDate: string | null; move: { move: number; sessions: number } | null }[];
    freshness: Freshness;
  };
  fundamentals: { latest: { concept: string; label: string; unit: string; period_end: string; fiscal_period: string | null; value: number; filed: string; accession: string; form: string; origin: string }[] };
  timeline: { at: string; type: string; title: string; accession: string; sourceUrl: string | null; origin: DataOrigin; periodOfReport: string | null; eventDate: string | null }[];
}

type Tab = 'overview' | 'institutions' | 'insiders' | 'events' | 'timeline';

export function StockPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const { data, error, loading, reload, stale } = useApi<StockData>(`/api/stocks/${encodeURIComponent(id)}`);
  if (loading && !data) return <Loading lines={5} />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const s = data.issuer;
  const b = data.breadth;
  const adders = b.new + b.increased;
  const cutters = b.reduced + b.exited;

  return (
    <>
      <StaleNotice show={stale} />
      <div className="page-head">
        <div className="badges"><OriginBadge origin={s.origin} />{s.sector && <span className="badge neutral">{s.sector}</span>}</div>
        <h1 style={{ marginTop: 6 }}>{s.ticker} <span className="muted" style={{ fontWeight: 500, fontSize: '1rem' }}>{s.name}</span></h1>
        <p className="subtle">SEC CIK <span className="mono">{s.cik}</span>{s.description ? ` · ${s.description}` : ''}</p>
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          <WatchButton kind="stock" id={s.ticker ?? s.cik} cik={s.cik} label={s.ticker ?? s.name} />
          <Link className="btn small" to={`/compare?type=stocks&ids=${s.ticker ?? s.cik}`}>Compare</Link>
          <Link className="btn small ghost" to={`/watchlist?tab=rules`}>Set alert</Link>
        </div>
      </div>

      <div className="kpis">
        <Kpi k="Last price" v={data.market.quote ? `$${data.market.quote.price.toFixed(2)}` : '—'} s={data.market.quote ? `${data.market.quote.isDemo ? 'Simulated' : data.market.quote.delay.replace('_', ' ')} · ${date(data.market.quote.asOf)}` : 'Market data unavailable'} />
        <Kpi k="Market cap" v={usd(s.marketCap)} s={s.marketCap != null ? `${s.origin === 'demo' ? 'Demo · ' : ''}${date(s.marketCapAsOf)}` : 'Unavailable'} />
        <Kpi k="Tracked holders" v={`${b.holders}/${b.trackedManagers}`} s={data.period ? `Q ended ${date(data.period)}` : 'No 13F period'} />
        <Kpi k="Adding vs cutting" v={<><span className="pos">{adders}</span> / <span className="neg">{cutters}</span></>} s="managers, share counts" />
      </div>

      <Tabs label="Stock sections" value={tab} onChange={(t) => setParams({ tab: t }, { replace: true })}
        tabs={[{ value: 'overview', label: 'Overview' }, { value: 'institutions', label: 'Institutions' }, { value: 'insiders', label: 'Insiders' }, { value: 'events', label: 'Events' }, { value: 'timeline', label: 'Timeline' }]} />

      {tab === 'overview' && (
        <div className="stack">
          <section className="card card-pad" aria-labelledby="mc-h">
            <div className="split"><h2 id="mc-h">Market context</h2><FreshnessBadge f={data.market.freshness} /></div>
            {data.market.bars.length > 1 ? (
              <>
                <div style={{ marginTop: 10 }}>
                  <PriceChart bars={data.market.bars} isDemo={!!data.market.quote?.isDemo} label={`${s.ticker} price`}
                    markers={data.events.filter((e) => e.category !== 'passive_ownership' && e.eventDate).slice(0, 6).map((e) => ({ date: e.eventDate!, label: `${e.formType}: ${e.headline}` }))} />
                </div>
                {data.market.context && (
                  <dl className="facts four" style={{ marginTop: 10 }}>
                    <div><dt>Trend</dt><dd>{data.market.context.trend === 'above_50d' ? 'Above 50-day avg' : data.market.context.trend === 'below_50d' ? 'Below 50-day avg' : 'Insufficient history'}</dd></div>
                    <div><dt>5-day</dt><dd className="num">{pct(data.market.context.return5d, { sign: true })}</dd></div>
                    <div><dt>20-day</dt><dd className="num">{pct(data.market.context.return20d, { sign: true })}</dd></div>
                    <div><dt>Volume z</dt><dd className="num">{data.market.context.volumeZ?.toFixed(2) ?? '—'}</dd></div>
                  </dl>
                )}
                {data.market.eventMoves.some((e) => e.move) && (
                  <div style={{ marginTop: 12 }}>
                    <div className="label">Price around events (close before → up to 5 sessions after)</div>
                    <ul className="list" style={{ fontSize: '0.86rem' }}>
                      {data.market.eventMoves.filter((e) => e.move).map((e) => (
                        <li key={e.accession + e.headline} className="split" style={{ padding: '6px 0' }}><span>{date(e.eventDate)} · {e.headline}</span><b className={`num ${e.move!.move >= 0 ? 'pos' : 'neg'}`}>{pct(e.move!.move, { sign: true })}</b></li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="state" style={{ padding: '18px 8px' }}><Icon name="info" /><p className="muted">{data.market.provider.message}</p></div>
            )}
          </section>

          <section className="card card-pad" aria-labelledby="br-h">
            <div className="split"><h2 id="br-h">Ownership breadth</h2><FreshnessBadge f={data.ownership.freshness} /></div>
            <p className="subtle" style={{ marginTop: 2 }}>Tracked managers by direction of reported share-count change{data.period ? `, quarter ended ${date(data.period)}` : ''}.</p>
            <BreadthBar b={b} />
          </section>

          <section className="card card-pad" aria-labelledby="fu-h">
            <h2 id="fu-h">Company fundamentals</h2>
            {data.fundamentals.latest.length ? (
              <dl className="facts four" style={{ marginTop: 10 }}>
                {data.fundamentals.latest.map((f) => (
                  <div key={f.label}><dt>{f.label} {f.fiscal_period ? `(${f.fiscal_period})` : ''}</dt><dd className="num">{f.unit === 'USD' ? usd(f.value) : f.unit === 'shares' ? shares(f.value) : f.value.toFixed(2)}</dd><dd className="subtle" style={{ fontWeight: 400 }}>{f.form} filed {date(f.filed)}{f.origin === 'demo' ? ' · demo' : ''}</dd></div>
                ))}
              </dl>
            ) : <p className="muted" style={{ marginTop: 6 }}>No XBRL company facts available as of this cutoff.</p>}
          </section>
        </div>
      )}

      {tab === 'institutions' && (
        <div className="stack">
          <section aria-labelledby="own-h">
            <div className="section-head"><h2 id="own-h">Ownership overview</h2><span className="subtle">{data.ownership.holders.length} tracked holder(s)</span></div>
            {data.ownership.holders.length ? (
              <div className="card"><ul className="list">
                {data.ownership.holders.map((h) => (
                  <li key={h.managerCik}><Link className="row-link" to={`/investors/${h.managerCik}`}>
                    <span className="grow"><span className="title">{h.managerName}</span><span className="meta"><span>{shares(h.shares)} sh</span><span>{usd(h.value)}</span><span>{pct(h.weight, { digits: 2 })} of portfolio</span></span></span>
                    <span className="right"><KindBadge kind={h.kind} /></span>
                  </Link></li>
                ))}
              </ul></div>
            ) : <EmptyState title="No tracked holders">No tracked manager reported this stock in the comparable quarter.</EmptyState>}
          </section>
          <section aria-labelledby="chg-h">
            <div className="section-head"><h2 id="chg-h">Institutional changes</h2></div>
            {data.changes.length ? <div className="stack">{data.changes.map((c) => <ChangeCard key={c.managerCik} c={c} showManager />)}</div> : <EmptyState title="No reported changes" />}
          </section>
        </div>
      )}

      {tab === 'insiders' && (
        <section aria-labelledby="ins-h">
          <div className="section-head"><h2 id="ins-h">Insider activity (12 months)</h2></div>
          <div className="banner info" role="note"><Icon name="info" size={18} /><span>{data.insider.summary.openMarketBuys} qualifying open-market purchase(s), {data.insider.summary.openMarketSales} open-market sale(s), {data.insider.summary.other} other transaction(s) — awards, exercises, tax withholding and gifts are classified separately.</span></div>
          {data.insider.transactions.length ? (
            <div className="stack">{data.insider.transactions.map((t) => <TxnCard key={t.id} t={t} />)}</div>
          ) : <EmptyState title="No Form 4 transactions">No insider transactions accepted in the last 12 months.</EmptyState>}
        </section>
      )}

      {tab === 'events' && (
        <section aria-labelledby="ev-h">
          <div className="section-head"><h2 id="ev-h">Corporate developments</h2></div>
          {data.events.length ? <div className="stack">{data.events.map((e) => <EventCard key={e.accession} e={e} />)}</div> : <EmptyState title="No recent 8-K or ownership filings" />}
        </section>
      )}

      {tab === 'timeline' && (
        <section aria-labelledby="tl-h">
          <div className="section-head"><h2 id="tl-h">Evidence timeline</h2><span className="subtle">by EDGAR acceptance</span></div>
          <ol className="card list" style={{ padding: 0 }}>
            {data.timeline.map((t, i) => (
              <li key={`${t.accession}-${i}`} style={{ padding: '10px 14px' }}>
                <div className="split"><span className="badge neutral">{t.type}</span><OriginBadge origin={t.origin} /></div>
                <p style={{ marginTop: 4, fontWeight: 560 }}>{t.title}</p>
                <Times period={t.periodOfReport} event={t.type === 'Form 4' ? null : t.eventDate} txn={t.type === 'Form 4' ? t.eventDate : null} accepted={t.at} />
                <div className="split" style={{ marginTop: 4 }}><Link className="link" to={`/filings/${t.accession}`}>Filing record</Link><SourceLink url={t.sourceUrl} accession={null} origin={t.origin} /></div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

function BreadthBar({ b }: { b: StockData['breadth'] }) {
  const parts = [
    { k: 'New', n: b.new, c: 'var(--pos)' }, { k: 'Increased', n: b.increased, c: 'color-mix(in srgb, var(--pos) 55%, transparent)' },
    { k: 'Unchanged', n: b.unchanged, c: 'var(--line-strong)' }, { k: 'Reduced', n: b.reduced, c: 'color-mix(in srgb, var(--neg) 55%, transparent)' }, { k: 'Exited', n: b.exited, c: 'var(--neg)' },
  ];
  const total = parts.reduce((s, p) => s + p.n, 0);
  if (!total) return <p className="muted" style={{ marginTop: 8 }}>No tracked manager reported this stock in either quarter.</p>;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', height: 14, borderRadius: 7, overflow: 'hidden', background: 'var(--bg-sunk)' }} role="img" aria-label={parts.map((p) => `${p.k}: ${p.n}`).join(', ')}>
        {parts.filter((p) => p.n).map((p) => <div key={p.k} style={{ width: `${(p.n / total) * 100}%`, background: p.c }} />)}
      </div>
      <div className="badges" style={{ marginTop: 8 }}>{parts.map((p) => <span key={p.k} className="subtle"><span aria-hidden="true" style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 3, background: p.c, marginRight: 4 }} />{p.k} {p.n}</span>)}</div>
    </div>
  );
}

export function TxnCard({ t }: { t: InsiderTransaction }) {
  return (
    <article className="card card-pad">
      <div className="split" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div className="badges"><span className={`badge cls-${t.classification} ${['open_market_purchase', 'open_market_sale'].includes(t.classification) ? '' : 'neutral'}`}>{t.classificationLabel}</span><span className="badge mode" title={t.codeLabel}>Code {t.code}</span>{t.isDerivative && <span className="badge neutral">Derivative</span>}{t.is10b51 && <span className="badge neutral" title="Reported as made under a Rule 10b5-1 trading plan">10b5-1 plan</span>}</div>
          <h3 style={{ marginTop: 6 }}>{t.ownerName}</h3>
          <p className="subtle">{t.ownerRole} · {t.securityTitle} · {t.directOrIndirect === 'D' ? 'Direct' : 'Indirect'}</p>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}>
          <div className={`num ${t.acquiredDisposed === 'A' ? 'pos' : 'neg'}`} style={{ fontWeight: 700 }}>{t.acquiredDisposed === 'A' ? '+' : '−'}{shares(t.shares)}</div>
          <div className="subtle num">{t.price != null ? `@ $${t.price.toFixed(2)}` : 'no price'}</div>
        </div>
      </div>
      <p className="subtle" style={{ marginTop: 6 }}>{t.codeLabel}{t.value != null ? ` · ${usd(t.value)}` : ''}{t.sharesOwnedAfter != null ? ` · ${shares(t.sharesOwnedAfter)} owned after` : ''}</p>
      <div className="split" style={{ marginTop: 6 }}><Times txn={t.transactionDate} accepted={t.acceptedAt} /><Link className="link" to={`/filings/${t.accession}`}>Filing</Link></div>
    </article>
  );
}

export function EventCard({ e }: { e: CorporateEvent }) {
  return (
    <article className="card card-pad">
      <div className="badges"><span className="badge cat">{e.formType}</span>{e.category === 'activist' && <span className="badge stale">Activist possible</span>}{e.isAmendment && <span className="badge neutral">Amendment</span>}<OriginBadge origin={e.origin} /></div>
      <h3 style={{ marginTop: 6 }}>{e.headline}</h3>
      {e.items.length > 0 && <ul className="subtle" style={{ margin: '4px 0 0', paddingLeft: 18 }}>{e.items.map((i) => <li key={i.code}>Item {i.code}: {i.label} <span title="Editorial research-relevance weight">(relevance {i.relevance})</span></li>)}</ul>}
      {e.filerName && e.category !== 'corporate_event' && <p className="subtle" style={{ marginTop: 4 }}>Filed by {e.filerName}{e.percentOfClass != null ? ` · ${e.percentOfClass}% of class` : ''}</p>}
      <div className="split" style={{ marginTop: 6 }}><Times event={e.eventDate} accepted={e.acceptedAt} /><Link className="link" to={`/filings/${e.accession}`}>Filing</Link></div>
    </article>
  );
}
