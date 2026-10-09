import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import type { DataOrigin, Freshness } from '../../shared/types.ts';
import { EmptyState, ErrorState, FreshnessBadge, Loading, OriginBadge, Segmented } from '../components/ui.tsx';
import { Icon } from '../icons.tsx';
import { date, pct, usd } from '../format.ts';

interface InvSide { cik: string; name: string; origin: DataOrigin; period: string | null; priorPeriod: string | null; acceptedAt: string | null; positions: number; totalValue: number; concentration: { top10Weight: number; largestWeight: number; hhi: number } | null; counts: Record<'new' | 'increased' | 'reduced' | 'exited', number>; sectors: { sector: string; weight: number }[] }
interface InvCompare { type: 'investors'; sides: InvSide[]; overlap: { cusip: string; ticker: string | null; name: string; weights: number[] }[]; periodsDiffer: boolean; comparablePeriod: string | null }
interface StockSide {
  issuer: { cik: string; name: string; ticker: string | null; sector: string | null; marketCap: number | null; origin: DataOrigin };
  period: string | null;
  breadth: { holders: number; new: number; increased: number; reduced: number; exited: number; trackedManagers: number };
  insider: { openMarketBuys: number; openMarketSales: number; other: number };
  insiderBuyValue: number;
  events: { formType: string; headline: string; acceptedAt: string; accession: string }[];
  fundamentals: { label: string; value: number; unit: string; fiscal_period: string | null; filed: string }[];
  market: { quote: { price: number; isDemo: boolean } | null; context: { return20d: number | null; trend: string } | null; freshness: Freshness };
  valuation: { ttmEps: number | null; pe: number | null; note: string; isDemo: boolean };
}
interface StockCompare { type: 'stocks'; sides: StockSide[] }

export function ComparePage() {
  const [params, setParams] = useSearchParams();
  const type = (params.get('type') as 'investors' | 'stocks') || 'investors';
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const investors = useApi<{ investors: { cik: string; name: string }[] }>('/api/investors');
  const stocks = useApi<{ stocks: { cik: string; ticker: string | null; name: string }[] }>('/api/stocks');
  const options = type === 'investors'
    ? (investors.data?.investors ?? []).map((i) => ({ id: i.cik, label: i.name }))
    : (stocks.data?.stocks ?? []).map((s) => ({ id: s.ticker ?? s.cik, label: `${s.ticker} · ${s.name}` }));
  const setIds = (next: string[]) => setParams({ type, ids: next.join(',') }, { replace: true });
  const cmp = useApi<InvCompare | StockCompare>(ids.length >= 2 ? `/api/compare?type=${type}&ids=${encodeURIComponent(ids.join(','))}` : null);

  return (
    <>
      <div className="page-head"><h1>Compare</h1><p className="muted">Side-by-side research cards for two to four investors or stocks.</p></div>
      <Segmented label="Compare type" value={type} onChange={(v) => setParams({ type: v }, { replace: true })} options={[{ value: 'investors', label: 'Investors' }, { value: 'stocks', label: 'Stocks' }]} />
      <div className="card card-pad stack" style={{ marginTop: 12 }}>
        {[0, 1, 2, 3].slice(0, Math.min(4, Math.max(2, ids.length + 1))).map((slot) => (
          <div key={slot} className="field">
            <label htmlFor={`cmp-${slot}`}>{type === 'investors' ? 'Investor' : 'Stock'} {slot + 1}{slot >= 2 ? ' (optional)' : ''}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select id={`cmp-${slot}`} className="input" value={ids[slot] ?? ''} onChange={(e) => { const n = [...ids]; if (e.target.value) n[slot] = e.target.value; else n.splice(slot, 1); setIds(n.filter(Boolean)); }}>
                <option value="">Choose…</option>
                {options.filter((o) => o.id === ids[slot] || !ids.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
              {ids[slot] && <button className="icon-btn" aria-label={`Remove ${type === 'investors' ? 'investor' : 'stock'} ${slot + 1}`} onClick={() => setIds(ids.filter((_, i) => i !== slot))}><Icon name="x" size={18} /></button>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 14 }}>
        {ids.length < 2 ? <EmptyState icon="compare" title="Choose at least two">Pick {type} above to compare them.</EmptyState>
          : cmp.loading && !cmp.data ? <Loading lines={3} />
            : cmp.error && !cmp.data ? <ErrorState error={cmp.error} onRetry={cmp.reload} />
              : cmp.data?.type === 'investors' ? <InvestorCompare d={cmp.data} />
                : cmp.data?.type === 'stocks' ? <StockCompareView d={cmp.data} /> : null}
      </div>
    </>
  );
}

const cols = (n: number) => ({ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 10 });

function Row({ label, values }: { label: string; values: React.ReactNode[] }) {
  return (
    <div style={{ padding: '9px 0', borderTop: '1px solid var(--line)' }}>
      <div className="label" style={{ marginBottom: 2 }}>{label}</div>
      <div style={cols(values.length)}>{values.map((v, i) => <div key={i} className="num" style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{v}</div>)}</div>
    </div>
  );
}

function InvestorCompare({ d }: { d: InvCompare }) {
  const s = d.sides;
  return (
    <div className="stack">
      {d.periodsDiffer && <div className="banner warn"><Icon name="alert" size={18} /><span>These investors’ latest filings cover different quarters; changes are not directly comparable.</span></div>}
      <div className="card card-pad">
        <div style={cols(s.length)}>{s.map((x) => <div key={x.cik}><Link to={`/investors/${x.cik}`} style={{ fontWeight: 700, textDecoration: 'none' }}>{x.name}</Link><div style={{ marginTop: 4 }}><OriginBadge origin={x.origin} /></div></div>)}</div>
        <div style={{ marginTop: 10 }}>
          <Row label="Reporting period" values={s.map((x) => date(x.period))} />
          <Row label="Reported value" values={s.map((x) => usd(x.totalValue))} />
          <Row label="Positions" values={s.map((x) => x.positions)} />
          <Row label="New / increased" values={s.map((x) => <><span className="pos">{x.counts.new}</span> / <span className="pos">{x.counts.increased}</span></>)} />
          <Row label="Reduced / exited" values={s.map((x) => <><span className="neg">{x.counts.reduced}</span> / <span className="neg">{x.counts.exited}</span></>)} />
          <Row label="Top-10 weight" values={s.map((x) => pct(x.concentration?.top10Weight))} />
          <Row label="Largest position" values={s.map((x) => pct(x.concentration?.largestWeight))} />
          <Row label="Top sector" values={s.map((x) => x.sectors[0] ? `${x.sectors[0].sector} ${pct(x.sectors[0].weight, { digits: 0 })}` : '—')} />
        </div>
      </div>
      <section className="card card-pad" aria-labelledby="ov-h">
        <h2 id="ov-h">Holdings overlap</h2>
        <p className="subtle">{d.overlap.length} security(ies) held by all selected investors (derived weights).</p>
        {d.overlap.length ? (
          <ul className="list" style={{ marginTop: 8 }}>
            {d.overlap.map((o) => (
              <li key={o.cusip} style={{ padding: '9px 0' }}>
                <div style={{ fontWeight: 650 }}>{o.ticker ?? o.cusip} <span className="subtle" style={{ fontWeight: 400 }}>{o.name}</span></div>
                <div style={{ ...cols(o.weights.length), marginTop: 2 }}>{o.weights.map((w, i) => <span key={i} className="num subtle">{pct(w, { digits: 2 })}</span>)}</div>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ marginTop: 8 }}>No common holdings.</p>}
      </section>
      <section className="card card-pad" aria-labelledby="sec-h">
        <h2 id="sec-h">Sector exposure</h2>
        <div style={{ ...cols(s.length), marginTop: 8 }}>
          {s.map((x) => <ul key={x.cik} className="list" style={{ fontSize: '0.84rem' }}>{x.sectors.slice(0, 6).map((sec) => <li key={sec.sector} style={{ padding: '4px 0' }}><div className="split"><span>{sec.sector}</span><span className="num">{pct(sec.weight, { digits: 0 })}</span></div><div className="bar"><i style={{ width: `${sec.weight * 100}%` }} /></div></li>)}</ul>)}
        </div>
      </section>
    </div>
  );
}

function StockCompareView({ d }: { d: StockCompare }) {
  const s = d.sides;
  const f = (x: StockSide, label: string) => x.fundamentals.find((y) => y.label === label);
  return (
    <div className="stack">
      <div className="card card-pad">
        <div style={cols(s.length)}>{s.map((x) => <div key={x.issuer.cik}><Link to={`/stocks/${x.issuer.ticker ?? x.issuer.cik}`} style={{ fontWeight: 750, textDecoration: 'none' }}>{x.issuer.ticker}</Link><div className="subtle" style={{ overflowWrap: 'anywhere' }}>{x.issuer.name}</div><div style={{ marginTop: 4 }}><OriginBadge origin={x.issuer.origin} /></div></div>)}</div>
        <div style={{ marginTop: 10 }}>
          <Row label="Tracked holders" values={s.map((x) => `${x.breadth.holders}/${x.breadth.trackedManagers}`)} />
          <Row label="Adding (new + increased)" values={s.map((x) => <span className="pos">{x.breadth.new + x.breadth.increased}</span>)} />
          <Row label="Cutting (reduced + exited)" values={s.map((x) => <span className="neg">{x.breadth.reduced + x.breadth.exited}</span>)} />
          <Row label="Insider open-market buys" values={s.map((x) => `${x.insider.openMarketBuys} · ${usd(x.insiderBuyValue)}`)} />
          <Row label="Insider open-market sales" values={s.map((x) => x.insider.openMarketSales)} />
          <Row label="Latest event" values={s.map((x) => x.events[0] ? `${x.events[0].formType}: ${x.events[0].headline}` : '—')} />
          <Row label="Revenue (latest quarter)" values={s.map((x) => usd(f(x, 'Revenue')?.value))} />
          <Row label="Net income (latest quarter)" values={s.map((x) => usd(f(x, 'Net income')?.value))} />
          <Row label="Market cap" values={s.map((x) => usd(x.issuer.marketCap))} />
          <Row label="Price · 20-day" values={s.map((x) => x.market.quote ? <>${x.market.quote.price.toFixed(2)} · {pct(x.market.context?.return20d, { sign: true })}</> : 'Unavailable')} />
          <Row label="P/E (TTM, derived)" values={s.map((x) => x.valuation.pe != null ? x.valuation.pe.toFixed(1) : '—')} />
          <Row label="Market data" values={s.map((x) => <FreshnessBadge f={x.market.freshness} />)} />
        </div>
        <p className="subtle" style={{ marginTop: 10 }}>{s[0]?.valuation.note} {s.some((x) => x.valuation.isDemo) ? 'Valuation uses simulated demo inputs.' : ''}</p>
      </div>
    </div>
  );
}
