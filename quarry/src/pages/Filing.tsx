import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApi } from '../api.ts';
import type { CorporateEvent, FilingRef, InsiderTransaction } from '../../shared/types.ts';
import { EmptyState, ErrorState, FreshnessBadge, Loading, OriginBadge, SourceLink } from '../components/ui.tsx';
import { FilingRow } from './Home.tsx';
import { TxnCard, EventCard } from './Stock.tsx';
import { dateTime, date, shares, usd } from '../format.ts';

interface FilingData {
  filing: FilingRef;
  holdings: { cusip: string; name: string; titleOfClass: string | null; shares: number; value: number; shPrnType: string; putCall: string | null; ticker: string | null; mapping: string | null }[];
  transactions: InsiderTransaction[];
  supersededBy: string | null;
  event: CorporateEvent | null;
  related: { accession: string; form_type: string; accepted_at: string; amendment_type: string | null }[];
  parseRuns: { parserVersion: string; status: string; rowCount: number; message: string | null; ranAt: string; supersededRows: number }[];
}

export function FilingPage() {
  const { accession = '' } = useParams();
  if (!accession) return <FilingsList />;
  return <FilingDetail accession={accession} />;
}

function FilingDetail({ accession }: { accession: string }) {
  const { data, error, loading, reload } = useApi<FilingData>(`/api/filings/${encodeURIComponent(accession)}`);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;
  const f = data.filing;
  return (
    <>
      <div className="page-head">
        <div className="badges"><span className="badge cat">{f.formType}</span>{f.freshness.status !== "demo" && <OriginBadge origin={f.origin} />}<FreshnessBadge f={f.freshness} /></div>
        <h1 style={{ marginTop: 6 }}>{f.subjectName && f.subjectCik !== f.filerCik ? f.subjectName : f.filerName ?? f.filerCik}</h1>
        <p className="subtle">Filed by {f.filerName ?? f.filerCik} · accession <span className="mono">{f.accession}</span></p>
      </div>
      <div className="card card-pad">
        <h2>Filing record</h2>
        <dl className="facts" style={{ marginTop: 10 }}>
          <div><dt>Form</dt><dd>{f.formType}{f.amendmentType ? ` (${f.amendmentType.toLowerCase()})` : ''}</dd></div>
          <div><dt>Filer CIK</dt><dd className="mono">{f.filerCik}</dd></div>
          <div><dt>Reporting period</dt><dd>{date(f.periodOfReport)}</dd></div>
          <div><dt>Filing date</dt><dd>{date(f.filingDate)}</dd></div>
          <div><dt>EDGAR accepted</dt><dd>{dateTime(f.acceptedAt)}</dd></div>
          <div><dt>Ingested by Quarry</dt><dd>{dateTime(f.ingestedAt)}</dd></div>
          <div><dt>Parse status</dt><dd>{f.parseStatus.replace('_', ' ')}</dd></div>
          <div><dt>Parser</dt><dd className="mono">{f.parserVersion}</dd></div>
        </dl>
        <div style={{ marginTop: 10 }}><SourceLink url={f.sourceUrl} accession={f.accession} origin={f.origin} /></div>
        <p className="subtle" style={{ marginTop: 8 }}>{f.freshness.reason}</p>
      </div>

      {data.supersededBy && <div className="banner warn" style={{ marginTop: 12 }}><span>This Form 4 has been superseded by amendment <Link className="link" to={`/filings/${data.supersededBy}`}>{data.supersededBy}</Link>. Research signals use the amended figures.</span></div>}
      {data.related.length > 0 && (
        <section className="section"><h2>Related filings (same filer, subject & period)</h2>
          <div className="card" style={{ marginTop: 8 }}><ul className="list">{data.related.map((r) => <li key={r.accession}><Link className="row-link" to={`/filings/${r.accession}`}><span className="grow"><span className="title">{r.form_type}{r.amendment_type ? ` · ${r.amendment_type.toLowerCase()}` : ''}</span><span className="meta">Accepted {dateTime(r.accepted_at)}</span></span></Link></li>)}</ul></div>
        </section>
      )}

      {data.holdings.length > 0 && (
        <section className="section"><h2>Reported holdings ({data.holdings.length} rows)</h2>
          <div className="card" style={{ marginTop: 8 }}><ul className="list">
            {data.holdings.map((h, i) => (
              <li key={`${h.cusip}-${i}`} className="row-link" style={{ cursor: 'default' }}>
                <span className="ticker-chip">{h.ticker ?? '—'}</span>
                <span className="grow"><span className="title">{h.name}</span><span className="meta"><span className="mono">{h.cusip}</span><span>{h.titleOfClass}</span>{h.putCall && <span className="badge neutral">{h.putCall}</span>}{h.mapping === 'unmapped' && <span className="badge unavailable">unmapped</span>}</span></span>
                <span className="right"><b className="num">{usd(h.value)}</b><div className="subtle num">{shares(h.shares)} {h.shPrnType}</div></span>
              </li>
            ))}
          </ul></div>
        </section>
      )}
      {data.transactions.length > 0 && <section className="section"><h2>Reported transactions</h2><div className="stack" style={{ marginTop: 8 }}>{data.transactions.map((t) => <TxnCard key={t.id} t={t} />)}</div></section>}
      {data.event && <section className="section"><h2>Disclosure</h2><div style={{ marginTop: 8 }}><EventCard e={data.event} /></div></section>}

      <section className="section"><h2>Provenance</h2>
        <div className="card" style={{ marginTop: 8 }}><ul className="list">
          {data.parseRuns.map((p, i) => <li key={i} className="card-pad" style={{ fontSize: '0.86rem' }}><b className="mono">{p.parserVersion}</b> · {p.status} · {p.rowCount} row(s) · {dateTime(p.ranAt)}{p.supersededRows ? ` · replaced ${p.supersededRows} earlier row(s)` : ''}{p.message ? <div className="subtle">{p.message}</div> : null}</li>)}
        </ul></div>
      </section>
    </>
  );
}

const FORMS = [['', 'All forms'], ['13F-HR', '13F'], ['4', 'Form 4'], ['8-K', '8-K'], ['SC 13D', '13D'], ['SC 13G', '13G']];

function FilingsList() {
  const [form, setForm] = useState('');
  const [page, setPage] = useState(0);
  const { data, error, loading, reload } = useApi<{ filings: FilingRef[] }>(`/api/filings?limit=25&offset=${page * 25}${form ? `&forms=${encodeURIComponent(form)}` : ''}`);
  return (
    <>
      <div className="page-head"><h1>Filings</h1><p className="muted">Every stored disclosure, newest EDGAR acceptance first.</p></div>
      <div className="chips" role="group" aria-label="Form type">{FORMS.map(([v, l]) => <button key={v} className="chip" aria-pressed={form === v} onClick={() => { setForm(v); setPage(0); }}>{l}</button>)}</div>
      {loading && !data ? <Loading /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : !data?.filings.length ? <EmptyState title="No filings" /> : (
        <>
          <div className="card"><ul className="list">{data.filings.map((f) => <FilingRow key={f.accession} f={f} />)}</ul></div>
          <nav className="pager" aria-label="Pagination">
            <button className="btn small" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <span className="subtle">Page {page + 1}</span>
            <button className="btn small" disabled={data.filings.length < 25} onClick={() => setPage((p) => p + 1)}>Next</button>
          </nav>
        </>
      )}
    </>
  );
}
