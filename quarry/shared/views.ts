// Pure view logic shared by the API server and the static preview build.
import type { RadarCandidate } from './types.ts';

export interface RadarFilter {
  mode?: 'positioning' | 'event' | 'all'; category?: string; sector?: string; minCap?: number; maxCap?: number; form?: string;
  filedFrom?: string; filedTo?: string; period?: string; institutional?: string; insider?: string; watchlist?: string; market?: string;
}

export function filterRadar(candidates: RadarCandidate[], q: RadarFilter, watchedCategories: Set<string>): RadarCandidate[] {
  const cats = q.category ? new Set(q.category.split(',')) : null;
  const insiderIssuers = new Set(candidates.filter((c) => c.category === 'insider_buying').map((c) => c.issuerCik));
  const instIssuers = new Set(candidates.filter((c) => c.mode === 'positioning' && c.category !== 'institutional_reduction').map((c) => c.issuerCik));
  return candidates.filter((c) =>
    (!q.mode || q.mode === 'all' || c.mode === q.mode) &&
    (!cats || cats.has(c.category)) &&
    (!q.sector || c.sector === q.sector) &&
    (q.minCap == null || (c.marketCap != null && c.marketCap >= q.minCap)) &&
    (q.maxCap == null || (c.marketCap != null && c.marketCap <= q.maxCap)) &&
    (!q.form || c.formTypes.some((f) => f.replace('/A', '') === q.form)) &&
    (!q.filedFrom || c.latestAcceptedAt.slice(0, 10) >= q.filedFrom) &&
    (!q.filedTo || c.latestAcceptedAt.slice(0, 10) <= q.filedTo) &&
    (!q.period || c.periodOfReport === q.period) &&
    (q.institutional !== '1' || instIssuers.has(c.issuerCik)) &&
    (q.insider !== '1' || insiderIssuers.has(c.issuerCik)) &&
    (q.watchlist !== '1' || c.onWatchlist || watchedCategories.has(c.category)) &&
    (q.market !== '1' || c.hasMarketConfirmation));
}

export interface ExploreRowLike { id: string; title: string; subtitle: string; sortValue: number; date: string; sector: string | null }

export function pageExplore<T extends ExploreRowLike>(rows: T[], q: { q?: string; sector?: string; sort: 'metric' | 'newest' | 'name'; page: number; pageSize: number }) {
  const term = q.q?.trim().toLowerCase();
  const filtered = rows.filter((r) => (!term || `${r.title} ${r.subtitle}`.toLowerCase().includes(term)) && (!q.sector || r.sector === q.sector));
  filtered.sort((a, b) => q.sort === 'newest' ? b.date.localeCompare(a.date) : q.sort === 'name' ? a.title.localeCompare(b.title) : b.sortValue - a.sortValue || a.id.localeCompare(b.id));
  const start = (q.page - 1) * q.pageSize;
  return {
    total: filtered.length, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(filtered.length / q.pageSize)),
    rows: filtered.slice(start, start + q.pageSize),
    sectors: [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort() as string[],
  };
}
