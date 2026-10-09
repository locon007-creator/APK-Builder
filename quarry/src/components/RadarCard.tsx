import { Link } from 'react-router-dom';
import type { RadarCandidate } from '../../shared/types.ts';
import { Disclosure, FreshnessBadge, SourceLink, Times } from './ui.tsx';
import { date, usd } from '../format.ts';
import { CATEGORY_LABELS } from '../labels.ts';

export function RadarCard({ c, compact = false }: { c: RadarCandidate; compact?: boolean }) {
  const stockHref = `/stocks/${encodeURIComponent(c.ticker ?? c.issuerCik)}`;
  return (
    <article className="card rcard" aria-labelledby={`rc-${c.id}`}>
      <div className="rcard-head">
        <div className="grow">
          <div className="badges" style={{ marginBottom: 6 }}>
            <span className="badge cat">{CATEGORY_LABELS[c.category]}</span>
            <FreshnessBadge f={c.freshness} />
            {c.onWatchlist && <span className="badge neutral">Watching</span>}
          </div>
          <h3 className="rcard-title" id={`rc-${c.id}`}>
            <Link to={stockHref}>{c.ticker ?? c.issuerCik}</Link>
            <span className="subtle" style={{ fontWeight: 500 }}>{c.issuerName}</span>
          </h3>
          <p className="rcard-headline">{c.headline}</p>
        </div>
        <div className="score" title={`Research priority ${c.ranking.score} of 100 — coverage ${Math.round(c.ranking.coverage * 100)}%`}>
          <div><b className="num">{Math.round(c.ranking.score)}</b><span>priority</span></div>
        </div>
      </div>

      <dl className="facts four">
        <div><dt>Supporting</dt><dd className="num">{c.supportingCount} {c.category === 'insider_buying' ? 'insider' : c.mode === 'positioning' ? 'manager' : c.category === 'activist' ? 'filer' : 'item'}{c.supportingCount === 1 ? '' : 's'}</dd></div>
        <div><dt>{c.periodOfReport ? 'Report period' : 'Event date'}</dt><dd>{date(c.periodOfReport ?? c.eventDate)}</dd></div>
        <div><dt>{c.category === 'unusual_market' ? 'Observed' : 'Latest accepted'}</dt><dd>{date(c.latestAcceptedAt)}</dd></div>
        <div><dt>Sector</dt><dd>{c.sector ?? '—'}</dd></div>
      </dl>

      {!compact && (
        <Disclosure label="Evidence & reasoning">
          <section className="qa"><h4>What changed?</h4><p>{c.whatChanged}</p></section>
          <section className="qa"><h4>Why might this matter?</h4><p>{c.whyItMatters}</p></section>
          <section className="qa"><h4>What should be verified next?</h4><ul>{c.verifyNext.map((v) => <li key={v}>{v}</li>)}</ul></section>
          <section className="qa">
            <h4>Supporting disclosures ({c.evidence.length})</h4>
            <ul className="evidence">
              {c.evidence.map((e, i) => (
                <li key={`${e.accession}-${i}`}>
                  <span>{e.summary}</span>
                  <Times period={e.periodOfReport} event={e.kind === 'event' ? e.eventDate : null} txn={e.kind === 'insider_transaction' ? e.eventDate : null} accepted={e.acceptedAt} />
                  <div className="split">
                    {e.accession ? <Link className="link" to={`/filings/${e.accession}`}>Filing record</Link> : <span />}
                    <SourceLink url={e.sourceUrl} accession={null} origin={e.origin} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
          <section className="qa">
            <h4>How the priority was calculated</h4>
            <RankingTable c={c} />
          </section>
          <div className="limitations" role="note">
            <strong>Limitations</strong>
            <ul>{c.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        </Disclosure>
      )}
    </article>
  );
}

export function RankingTable({ c }: { c: RadarCandidate }) {
  const r = c.ranking;
  return (
    <div>
      <div className="scroll-x">
        <table className="rank-table">
          <thead><tr><th>Input</th><th className="num">Weight</th><th className="num">Score</th></tr></thead>
          <tbody>
            {r.inputs.map((i) => (
              <tr key={i.key}>
                <td>
                  {i.label} <span className="subtle">— {i.raw}</span>
                  <span className="formula">{i.formula}</span>
                  {i.normalized != null && <div className="bar" aria-hidden="true"><i style={{ width: `${i.normalized * 100}%` }} /></div>}
                </td>
                <td className="num">{i.weight}</td>
                <td className="num">{i.normalized == null ? <span className="badge unavailable">Missing</span> : i.normalized.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="subtle" style={{ marginTop: 8 }}>
        Priority <b>{r.score}</b> · coverage {Math.round(r.coverage * 100)}%{r.missing.length ? ` · missing: ${r.missing.join(', ')}` : ''} · cutoff {date(r.asOf)}
      </p>
      <p className="subtle" style={{ marginTop: 6 }}>{r.method}</p>
      {c.marketCap != null && <p className="subtle" style={{ marginTop: 6 }}>Market cap {usd(c.marketCap)} {c.origin === 'demo' ? '(demo)' : ''}</p>}
    </div>
  );
}
