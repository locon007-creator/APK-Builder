import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api.ts';
import { EmptyState, Loading, OriginBadge } from '../components/ui.tsx';
import { Icon } from '../icons.tsx';
import type { DataOrigin } from '../../shared/types.ts';

interface Result { kind: 'stock' | 'manager'; id: string; label: string; sublabel: string; origin: DataOrigin }

export function SearchPage() {
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 200); return () => clearTimeout(t); }, [q]);
  const { data, loading } = useApi<{ results: Result[] }>(term ? `/api/search?q=${encodeURIComponent(term)}` : null);
  return (
    <>
      <div className="page-head"><h1>Search</h1></div>
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <label htmlFor="search-q" className="sr-only">Search stocks and investors</label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: 12, color: 'var(--ink-3)' }}><Icon name="search" /></span>
          <input ref={input} id="search-q" className="input" type="search" autoComplete="off" placeholder="Ticker, company, investor or CIK" value={q} onChange={(e) => setQ(e.target.value)} style={{ paddingLeft: 42, minHeight: 50, fontSize: '1rem' }} />
        </div>
      </form>
      <div style={{ marginTop: 14 }} aria-live="polite">
        {!term ? <p className="subtle">Search tracked stocks by ticker or name, and investment managers by name or SEC CIK.</p>
          : loading && !data ? <Loading lines={2} label="Searching" />
            : !data?.results.length ? <EmptyState icon="search" title={`No matches for “${term}”`}>Only tracked stocks and managers are searchable.</EmptyState>
              : (
                <div className="card"><ul className="list">
                  {data.results.map((r) => (
                    <li key={`${r.kind}-${r.id}`}><Link className="row-link" to={r.kind === 'stock' ? `/stocks/${r.id}` : `/investors/${r.id}`}>
                      <span className="ticker-chip" aria-hidden="true"><Icon name={r.kind === 'stock' ? 'building' : 'users'} size={18} /></span>
                      <span className="grow"><span className="title">{r.label}</span><span className="meta">{r.sublabel}</span></span>
                      <OriginBadge origin={r.origin} />
                    </Link></li>
                  ))}
                </ul></div>
              )}
      </div>
    </>
  );
}
