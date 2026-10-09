import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string, public offline = false) { super(message); }
}

let currentAsOf: string | null = null;
const cache = new Map<string, unknown>();
const listeners = new Set<() => void>();

function withAsOf(path: string): string {
  if (!currentAsOf) return path;
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}asOf=${encodeURIComponent(currentAsOf)}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(withAsOf(path), {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, navigator.onLine ? 'The server could not be reached.' : 'You are offline.', !navigator.onLine);
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError(res.status, json?.error ?? `Request failed (${res.status})`);
  return json as T;
}

export const api = {
  setAsOf(d: string | null) { currentAsOf = d; },
  clearCache() { cache.clear(); listeners.forEach((l) => l()); },
  /** Invalidate cached GETs whose path starts with a prefix (after a mutation). */
  invalidate(prefix: string) {
    for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
    listeners.forEach((l) => l());
  },
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T,>(path: string, body: unknown) => request<T>('PUT', path, body),
  del: <T,>(path: string) => request<T>('DELETE', path),
};

export interface ApiState<T> { data: T | null; error: ApiError | null; loading: boolean; reload: () => void; stale: boolean }

/** Stale-while-revalidate fetch hook. Cached data is shown immediately (and kept when offline). */
export function useApi<T>(path: string | null): ApiState<T> {
  const key = path ? withAsOf(path) : null;
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean; stale: boolean }>(() => ({
    data: key && cache.has(key) ? (cache.get(key) as T) : null, error: null, loading: !!key, stale: false,
  }));
  const [tick, setTick] = useState(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);

  useEffect(() => {
    if (!path || !key) return;
    let cancelled = false;
    const cached = cache.has(key) ? (cache.get(key) as T) : null;
    setState({ data: cached, error: null, loading: true, stale: false });
    request<T>('GET', path).then(
      (data) => {
        cache.set(key, data);
        if (!cancelled) setState({ data, error: null, loading: false, stale: false });
      },
      (error: ApiError) => {
        if (!cancelled) setState({ data: cached, error, loading: false, stale: !!cached });
      },
    );
    return () => { cancelled = true; };
  }, [key, tick]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => { if (key) cache.delete(key); setTick((t) => t + 1); }, [key]);
  return { ...state, reload };
}

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}
