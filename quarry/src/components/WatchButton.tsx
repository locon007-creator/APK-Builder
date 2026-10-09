import { useApi, api } from '../api.ts';
import type { WatchItem } from '../../shared/types.ts';
import { Icon } from '../icons.tsx';
import { toast } from './ui.tsx';
import { useState } from 'react';

export function WatchButton({ kind, id, cik, label }: { kind: WatchItem['kind']; id: string; cik?: string; label: string }) {
  const { data, reload } = useApi<{ items: WatchItem[] }>('/api/watchlist');
  const [busy, setBusy] = useState(false);
  const matchId = cik ?? id;
  const on = !!data?.items.some((i) => i.kind === kind && i.id === matchId);
  const toggle = async () => {
    setBusy(true);
    try {
      if (on) await api.del(`/api/watchlist/${kind}/${encodeURIComponent(matchId)}`);
      else await api.post('/api/watchlist', { kind, id });
      api.invalidate('/api/watchlist');
      api.invalidate('/api/home');
      api.invalidate('/api/radar');
      reload();
      toast(on ? `Removed ${label} from watchlist` : `Following ${label}`);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className={`btn small ${on ? 'on' : ''}`} onClick={toggle} disabled={busy || !data} aria-pressed={on}>
      <Icon name={on ? 'check' : 'bookmark'} size={16} />
      {on ? 'Following' : 'Follow'}
      <span className="sr-only"> {label}</span>
    </button>
  );
}
