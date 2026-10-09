import { useState } from 'react';
import { useApi } from '../api.ts';
import { useSettings, type Theme } from '../settings.tsx';
import type { DatasetInfo } from '../../shared/types.ts';
import { ErrorState, Loading, Segmented } from '../components/ui.tsx';
import { Icon } from '../icons.tsx';
import { dateTime, date } from '../format.ts';

interface StatusData extends DatasetInfo {
  demoAnchor: string | null;
  ingestion: {
    runs: { id: number; started_at: string; finished_at: string | null; source: string; status: string; filings_seen: number; filings_new: number; errors: number; message: string | null }[];
    errors: { at: string; url: string | null; accession: string | null; message: string }[];
    parse: { base_form: string; parse_status: string; n: number }[];
    unmappedCusips: number;
  };
  freshnessThresholds: Record<string, number>;
}
interface Meta { rankingMethod: string; categories: Record<string, { label: string; description: string; mode: string }> }

export function SettingsPage() {
  const { theme, setTheme, asOf, setAsOf } = useSettings();
  const status = useApi<StatusData>('/api/status');
  const meta = useApi<Meta>('/api/meta');
  const [draft, setDraft] = useState(asOf ?? '');
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <div className="page-head"><h1>Settings & data</h1><p className="muted">Appearance, historical cutoff, data sources and methodology.</p></div>

      <section className="card card-pad stack" aria-labelledby="ap-h">
        <h2 id="ap-h">Appearance</h2>
        <Segmented<Theme> label="Theme" value={theme} onChange={setTheme} options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
      </section>

      <section className="card card-pad stack" aria-labelledby="hist-h" style={{ marginTop: 12 }}>
        <h2 id="hist-h">Historical view</h2>
        <p className="subtle">See every screen as it would have looked on a past date. Only filings accepted by EDGAR and prices observed on or before the cutoff are used; later amendments are not applied retroactively.</p>
        <form className="toolbar" style={{ marginBottom: 0 }} onSubmit={(e) => { e.preventDefault(); setAsOf(draft || null); }}>
          <label htmlFor="asof" className="sr-only">Cutoff date</label>
          <input id="asof" type="date" className="input grow" max={today} value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button type="submit" className="btn primary small" disabled={!draft || draft === asOf}>Apply</button>
          {asOf && <button type="button" className="btn small" onClick={() => { setDraft(''); setAsOf(null); }}>Return to now</button>}
        </form>
        {asOf && <p className="subtle">Active cutoff: end of {date(asOf)} (UTC).</p>}
      </section>

      <section className="card card-pad" aria-labelledby="ds-h" style={{ marginTop: 12 }}>
        <h2 id="ds-h">Data status</h2>
        {status.loading && !status.data ? <Loading lines={1} /> : status.error && !status.data ? <ErrorState error={status.error} onRetry={status.reload} /> : status.data && (
          <>
            <dl className="facts" style={{ marginTop: 10 }}>
              <div><dt>Dataset</dt><dd>{status.data.isDemo ? <span className="badge demo">Demo (fictional)</span> : <span className="badge historical">SEC EDGAR</span>}</dd></div>
              <div><dt>Latest acceptance</dt><dd>{dateTime(status.data.latestAcceptedAt)}</dd></div>
              <div><dt>Latest ingestion</dt><dd>{dateTime(status.data.latestIngestedAt)}</dd></div>
              <div><dt>Server time</dt><dd>{dateTime(status.data.now)}</dd></div>
              <div><dt>Market data</dt><dd>{status.data.market.name}{status.data.market.isDemo ? ' (simulated)' : status.data.market.configured ? '' : ' — not configured'}</dd></div>
              <div><dt>Alert delivery</dt><dd>In-app{status.data.delivery.webhook ? ' + webhook' : ' only'}</dd></div>
            </dl>
            <div className={`banner ${status.data.market.configured ? 'info' : 'warn'}`} style={{ marginTop: 12 }}><Icon name="info" size={18} /><span>{status.data.market.message}</span></div>
            {status.data.isDemo && <div className="banner demo"><Icon name="flask" size={18} /><span>The demo dataset was generated {status.data.demoAnchor ? dateTime(status.data.demoAnchor) : ''} by writing EDGAR-format XML and running it through the production parsers. It is fictional and never mixed with SEC data.</span></div>}
            <h3 style={{ marginTop: 14 }}>Parsed filings</h3>
            <ul className="list" style={{ fontSize: '0.86rem', marginTop: 4 }}>
              {status.data.ingestion.parse.map((p) => <li key={p.base_form + p.parse_status} className="split" style={{ padding: '6px 0' }}><span>{p.base_form} · {p.parse_status.replace('_', ' ')}</span><b className="num">{p.n}</b></li>)}
              <li className="split" style={{ padding: '6px 0' }}><span>Unmapped CUSIPs (shown, but not linked to a stock)</span><b className="num">{status.data.ingestion.unmappedCusips}</b></li>
            </ul>
            <h3 style={{ marginTop: 14 }}>Ingestion runs</h3>
            <ul className="list" style={{ fontSize: '0.84rem', marginTop: 4 }}>
              {status.data.ingestion.runs.map((r) => <li key={r.id} style={{ padding: '6px 0' }}><b>{r.source}</b> · {r.status} · {dateTime(r.started_at)}<div className="subtle">{r.message}</div></li>)}
            </ul>
            {status.data.ingestion.errors.length > 0 && (
              <><h3 style={{ marginTop: 14 }}>Recent ingestion errors</h3>
                <ul className="list" style={{ fontSize: '0.82rem' }}>{status.data.ingestion.errors.map((e, i) => <li key={i} style={{ padding: '6px 0' }}>{dateTime(e.at)} · {e.accession ?? e.url}<div className="neg">{e.message}</div></li>)}</ul></>
            )}
            <h3 style={{ marginTop: 14 }}>Freshness thresholds</h3>
            <ul className="subtle" style={{ paddingLeft: 18 }}>
              <li>Recently filed: accepted within {status.data.freshnessThresholds.recentlyFiledDays} days.</li>
              <li>Event filings become stale after {status.data.freshnessThresholds.eventStaleDays} days.</li>
              <li>13F holdings become stale {status.data.freshnessThresholds.holdingsStaleDays} days after period end.</li>
              <li>Market data becomes stale after {status.data.freshnessThresholds.marketStaleDays} days without a new observation.</li>
            </ul>
          </>
        )}
      </section>

      <section className="card card-pad" aria-labelledby="me-h" style={{ marginTop: 12 }}>
        <h2 id="me-h">Methodology</h2>
        {meta.data && (
          <>
            <p className="subtle" style={{ marginTop: 6 }}>{meta.data.rankingMethod}</p>
            <ul className="list" style={{ marginTop: 8 }}>
              {Object.entries(meta.data.categories).map(([k, c]) => <li key={k} style={{ padding: '8px 0' }}><b>{c.label}</b> <span className="badge mode">{c.mode === 'positioning' ? 'Positioning' : 'Event'}</span><div className="subtle">{c.description}</div></li>)}
            </ul>
          </>
        )}
        <hr className="soft" />
        <p className="subtle">13F filings are delayed quarter-end snapshots of long positions in 13(f) securities. They do not reveal trade dates, prices, cash or short positions. Form 4 transaction codes are classified so that awards, option exercises, tax withholding and gifts are never shown as open-market purchases.</p>
      </section>
    </>
  );
}
