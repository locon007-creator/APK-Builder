import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useApi, api } from '../api.ts';
import type { RadarCandidate, RadarCategory } from '../../shared/types.ts';
import { EmptyState, ErrorState, Loading, Segmented, Sheet, StaleNotice, toast } from '../components/ui.tsx';
import { RadarCard } from '../components/RadarCard.tsx';
import { Icon } from '../icons.tsx';
import { CATEGORY_LABELS, EVENT, POSITIONING } from '../labels.ts';
import { date } from '../format.ts';

interface RadarData {
  asOf: string;
  period: string | null;
  periodFilers: number;
  trackedManagers: number;
  candidates: RadarCandidate[];
  total: number;
  categoryStatus: Record<RadarCategory, { available: boolean; message: string; count: number }>;
  sectors: string[];
  unmappedChanges: number;
  watchedCategories: string[];
}

const FILTER_KEYS = ['sector', 'minCap', 'maxCap', 'form', 'filedFrom', 'filedTo', 'period', 'institutional', 'insider', 'watchlist', 'market'] as const;

const MODE_COPY = {
  positioning: { title: 'Institutional positioning', body: 'Longer-term ownership patterns from quarterly 13F snapshots. Filed up to 45 days after quarter-end — context, not a trading trigger.' },
  event: { title: 'Event & swing research', body: 'Timelier disclosures: Form 4 insider transactions, 8-K corporate events, Schedule 13D/G ownership and (with a provider) unusual market activity.' },
  all: { title: 'All research signals', body: 'Every candidate, ordered by transparent research priority. Open “Evidence & reasoning” on any card to see exactly how it qualified.' },
};

export function RadarPage() {
  const [params, setParams] = useSearchParams();
  const mode = (params.get('mode') as 'positioning' | 'event' | 'all') || 'all';
  const category = params.get('category') as RadarCategory | null;
  const [sheet, setSheet] = useState(false);
  const qs = new URLSearchParams();
  for (const k of FILTER_KEYS) { const v = params.get(k); if (v) qs.set(k, v); }
  const { data, error, loading, reload, stale } = useApi<RadarData>(`/api/radar?${qs.toString()}`);
  const activeFilters = FILTER_KEYS.filter((k) => params.get(k)).length;

  const update = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) { if (v == null || v === '') next.delete(k); else next.set(k, v); }
    setParams(next, { replace: true });
  };

  const cats = mode === 'positioning' ? POSITIONING : mode === 'event' ? EVENT : [...POSITIONING, ...EVENT];
  const list = useMemo(() => (data?.candidates ?? []).filter((c) => (mode === 'all' || c.mode === mode) && (!category || c.category === category)), [data, mode, category]);
  const countIn = (c: RadarCategory) => (data?.candidates ?? []).filter((x) => x.category === c).length;
  const catStatus = category && data ? data.categoryStatus[category] : null;
  const watchingCategory = category && data?.watchedCategories.includes(category);

  const followCategory = async () => {
    if (!category) return;
    try {
      if (watchingCategory) await api.del(`/api/watchlist/category/${category}`);
      else await api.post('/api/watchlist', { kind: 'category', id: category });
      api.invalidate('/api/watchlist'); reload();
      toast(watchingCategory ? 'Stopped following category' : `Following ${CATEGORY_LABELS[category]}`);
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <>
      <StaleNotice show={stale} />
      <div className="page-head">
        <div className="row"><h1>Opportunity Radar</h1>
          <button className={`btn small ${activeFilters ? 'on' : ''}`} onClick={() => setSheet(true)} aria-haspopup="dialog"><Icon name="filter" size={16} />Filters{activeFilters ? ` · ${activeFilters}` : ''}</button>
        </div>
        <p className="muted">Stocks worth researching, ranked by documented evidence — not predictions.</p>
      </div>

      <Segmented label="Research mode" value={mode} onChange={(v) => update({ mode: v === 'all' ? null : v, category: null })}
        options={[{ value: 'all', label: 'All' }, { value: 'positioning', label: 'Positioning' }, { value: 'event', label: 'Events' }]} />

      <div className="card card-pad" style={{ marginTop: 12, background: 'var(--bg-sunk)', boxShadow: 'none' }}>
        <h2 style={{ fontSize: '0.95rem' }}>{MODE_COPY[mode].title}</h2>
        <p className="subtle" style={{ marginTop: 2 }}>{MODE_COPY[mode].body}</p>
        {data && <p className="subtle" style={{ marginTop: 6 }}>Comparable 13F quarter: <b>{data.period ? date(data.period) : 'none'}</b> ({data.periodFilers}/{data.trackedManagers} tracked managers filed) · cutoff {date(data.asOf)}</p>}
      </div>

      <div className="chips" role="group" aria-label="Research category" style={{ marginTop: 12 }}>
        <button className="chip" aria-pressed={!category} onClick={() => update({ category: null })}>All <span className="count">{data ? list.length : ''}</span></button>
        {cats.map((c) => (
          <button key={c} className="chip" aria-pressed={category === c} onClick={() => update({ category: category === c ? null : c })}>
            {CATEGORY_LABELS[c]} <span className="count">{data ? (data.categoryStatus[c].available ? countIn(c) : 'n/a') : ''}</span>
          </button>
        ))}
      </div>

      {catStatus && (
        <div className={`banner ${catStatus.available ? 'info' : 'warn'}`} role="note">
          <Icon name={catStatus.available ? 'info' : 'alert'} size={18} />
          <span>{catStatus.message}</span>
          {catStatus.available && <button className="btn small" onClick={followCategory}>{watchingCategory ? 'Following' : 'Follow category'}</button>}
        </div>
      )}

      {loading && !data ? <Loading lines={4} label="Loading radar" /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : list.length === 0 ? (
        <EmptyState icon="radar" title="No matching candidates" action={activeFilters ? <button className="btn small" onClick={() => update(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}>Clear filters</button> : undefined}>
          {catStatus && !catStatus.available ? catStatus.message : 'Try another category or loosen the filters.'}
        </EmptyState>
      ) : (
        <div className="stack" aria-live="polite">
          <p className="subtle">{list.length} candidate{list.length === 1 ? '' : 's'}{activeFilters ? ` (filtered from ${data?.total})` : ''}</p>
          {list.map((c) => <RadarCard key={c.id} c={c} />)}
        </div>
      )}

      <Sheet open={sheet} title="Filter Radar" onClose={() => setSheet(false)}>
        {data && <RadarFilters data={data} params={params} onApply={(p) => { update(p); setSheet(false); }} />}
      </Sheet>
    </>
  );
}

function RadarFilters({ data, params, onApply }: { data: RadarData; params: URLSearchParams; onApply: (p: Record<string, string | null>) => void }) {
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])));
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k: string) => setF((x) => ({ ...x, [k]: x[k] === '1' ? '' : '1' }));
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); onApply(f); }}>
      <div className="field"><label htmlFor="f-sector">Sector</label>
        <select id="f-sector" className="input" value={f.sector} onChange={(e) => set('sector', e.target.value)}>
          <option value="">Any sector</option>{data.sectors.map((s) => <option key={s}>{s}</option>)}
        </select></div>
      <div className="field"><label htmlFor="f-cap">Market capitalization</label>
        <select id="f-cap" className="input" value={`${f.minCap}|${f.maxCap}`} onChange={(e) => { const [a, b] = e.target.value.split('|'); setF((x) => ({ ...x, minCap: a, maxCap: b })); }}>
          <option value="|">Any size</option><option value="|2000000000">Small (&lt; $2B)</option><option value="2000000000|10000000000">Mid ($2B–$10B)</option><option value="10000000000|">Large (&gt; $10B)</option>
        </select>
        <span className="subtle">Only candidates with a known market cap match a size filter.</span></div>
      <div className="field"><label htmlFor="f-form">Filing type</label>
        <select id="f-form" className="input" value={f.form} onChange={(e) => set('form', e.target.value)}>
          <option value="">Any form</option><option value="13F-HR">13F (institutional holdings)</option><option value="4">Form 4 (insiders)</option><option value="8-K">8-K (corporate events)</option><option value="SC 13D">Schedule 13D (activist)</option>
        </select></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div className="field"><label htmlFor="f-from">Filed from</label><input id="f-from" type="date" className="input" value={f.filedFrom} onChange={(e) => set('filedFrom', e.target.value)} /></div>
        <div className="field"><label htmlFor="f-to">Filed to</label><input id="f-to" type="date" className="input" value={f.filedTo} onChange={(e) => set('filedTo', e.target.value)} /></div>
      </div>
      <div className="field"><label htmlFor="f-period">13F reporting period</label>
        <select id="f-period" className="input" value={f.period} onChange={(e) => set('period', e.target.value)}>
          <option value="">Any</option>{data.period && <option value={data.period}>{date(data.period)}</option>}
        </select></div>
      <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label">Must also have</legend>
        <label className="check"><input type="checkbox" checked={f.institutional === '1'} onChange={() => toggle('institutional')} />Institutional adds (13F)</label>
        <label className="check"><input type="checkbox" checked={f.insider === '1'} onChange={() => toggle('insider')} />Insider open-market buying</label>
        <label className="check"><input type="checkbox" checked={f.market === '1'} onChange={() => toggle('market')} disabled={!data.categoryStatus.unusual_market.available} />Market confirmation (unusual volume or move)</label>
        <label className="check"><input type="checkbox" checked={f.watchlist === '1'} onChange={() => toggle('watchlist')} />On my watchlist</label>
      </fieldset>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" className="btn" style={{ flex: 1 }} onClick={() => onApply(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])))}>Clear</button>
        <button type="submit" className="btn primary" style={{ flex: 2 }}>Show results</button>
      </div>
    </form>
  );
}
