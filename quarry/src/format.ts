export function usd(n: number | null | undefined, opts: { compact?: boolean; sign?: boolean } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = opts.sign && n > 0 ? '+' : n < 0 ? '−' : '';
  const a = Math.abs(n);
  const compact = opts.compact ?? true;
  if (compact && a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`;
  if (compact && a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (compact && a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (compact && a >= 1e4) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toLocaleString('en-US', { maximumFractionDigits: a < 100 ? 2 : 0 })}`;
}

export function shares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toLocaleString('en-US')}`;
}

export function pct(n: number | null | undefined, opts: { sign?: boolean; digits?: number } = {}): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const v = (n * 100).toFixed(opts.digits ?? 1);
  return `${opts.sign && n > 0 ? '+' : ''}${v.replace('-', '−')}%`;
}

export function date(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

let referenceNow: number | null = null;
/** The preview build pins "now" to when its data snapshot was taken, so relative times stay truthful. */
export function setReferenceNow(iso: string | null) { referenceNow = iso ? Date.parse(iso) : null; }

export function ago(iso: string | null | undefined, now = referenceNow ?? Date.now()): string {
  if (!iso) return '—';
  const s = (now - new Date(iso).getTime()) / 1000;
  if (s < 0) return 'upcoming';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 45) return `${Math.round(s / 86400)}d ago`;
  return date(iso);
}

export const KIND_LABEL: Record<string, string> = { new: 'New', increased: 'Increased', reduced: 'Reduced', exited: 'Exited', unchanged: 'Unchanged' };
