import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { DataOrigin, Freshness } from '../../shared/types.ts';
import type { ApiError } from '../api.ts';
import { Icon, type IconName } from '../icons.tsx';
import { date, dateTime } from '../format.ts';

export function FreshnessBadge({ f }: { f: Freshness }) {
  return (
    <span className={`badge ${f.status}`} title={f.reason}>
      {f.label}
      <span className="sr-only">: {f.reason}</span>
    </span>
  );
}

export function OriginBadge({ origin }: { origin: DataOrigin }) {
  return origin === 'demo' ? <span className="badge demo" title="Fictional demonstration data">Demo</span> : <span className="badge historical" title="Official SEC EDGAR data">SEC</span>;
}

/** Labelled timestamps — keeps period, transaction, filing, acceptance and ingestion times distinct. */
export function Times({ period, event, txn, accepted, ingested, observed }: { period?: string | null; event?: string | null; txn?: string | null; accepted?: string | null; ingested?: string | null; observed?: string | null }) {
  return (
    <div className="timestamps">
      {period && <span><b>Period</b> {date(period)}</span>}
      {txn && <span><b>Transaction</b> {date(txn)}</span>}
      {event && <span><b>Event</b> {date(event)}</span>}
      {accepted && <span><b>Accepted</b> <time dateTime={accepted}>{dateTime(accepted)}</time></span>}
      {observed && <span><b>Observed</b> <time dateTime={observed}>{dateTime(observed)}</time></span>}
      {ingested && <span><b>Ingested</b> <time dateTime={ingested}>{dateTime(ingested)}</time></span>}
    </div>
  );
}

export function Loading({ lines = 3, label = 'Loading' }: { lines?: number; label?: string }) {
  return (
    <div className="stack" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton" style={{ height: i === 0 ? 92 : 64 }} />)}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

export function EmptyState({ icon = 'info', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card state">
      <Icon name={icon} size={28} />
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="card state" role="alert">
      <Icon name={error.offline ? 'wifiOff' : 'alert'} size={28} />
      <h3>{error.offline ? 'You are offline' : error.status === 404 ? 'Not found' : 'Something went wrong'}</h3>
      <p className="muted">{error.message}</p>
      {onRetry && <button className="btn small" onClick={onRetry}><Icon name="refresh" size={16} />Try again</button>}
    </div>
  );
}

export function StaleNotice({ show }: { show: boolean }) {
  if (!show) return null;
  return <div className="banner warn" role="status"><Icon name="wifiOff" size={18} /><span>Showing the last loaded copy — refresh failed. Figures may be out of date.</span></div>;
}

export function Disclosure({ label, children, defaultOpen = false }: { label: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className="disclosure">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? `Hide ${label.toLowerCase()}` : label}
        <Icon name="chevronDown" size={18} />
      </button>
      {open && <div id={id} className="disclosure-body">{children}</div>}
    </div>
  );
}

export function Sheet({ open, title, onClose, children }: { open: boolean; title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; prev?.focus(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="grabber" />
        <div className="sheet-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button></div>
        {children}
      </div>
    </>
  );
}

let toastSetter: ((m: string | null) => void) | null = null;
export function toast(message: string) { toastSetter?.(message); }
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { toastSetter = setMsg; return () => { toastSetter = null; }; }, []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t); }, [msg]);
  return <div aria-live="polite" role="status">{msg && <div className="toast">{msg}</div>}</div>;
}

export function SourceLink({ url, accession, origin }: { url: string | null; accession: string | null; origin: DataOrigin }) {
  if (origin === 'demo') return <span className="subtle">Demo record · no SEC source{accession ? ` · ${accession}` : ''}</span>;
  if (!url) return accession ? <span className="subtle mono">{accession}</span> : null;
  return <a className="link" href={url} target="_blank" rel="noopener noreferrer">View on SEC EDGAR <Icon name="external" size={13} style={{ display: 'inline', verticalAlign: '-2px' }} /><span className="sr-only"> (opens in new tab)</span></a>;
}

export function Kpi({ k, v, s }: { k: string; v: ReactNode; s?: ReactNode }) {
  return <div className="kpi"><div className="k">{k}</div><div className="v num">{v}</div>{s && <div className="s">{s}</div>}</div>;
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange, label }: { value: T; tabs: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" aria-selected={value === t.value} onClick={() => onChange(t.value)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.value === value);
            if (e.key === 'ArrowRight') onChange(tabs[(i + 1) % tabs.length].value);
            if (e.key === 'ArrowLeft') onChange(tabs[(i - 1 + tabs.length) % tabs.length].value);
          }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function KindBadge({ kind }: { kind: string }) {
  const label = { new: 'New', increased: 'Increased', reduced: 'Reduced', exited: 'Exited', unchanged: 'Unchanged' }[kind] ?? kind;
  return <span className={`badge kind-${kind}`}>{label}</span>;
}
