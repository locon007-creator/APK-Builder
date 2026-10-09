// In-browser stand-in for the Quarry API, used only by the static preview build.
// Read-only data comes from a snapshot exported from the real server; watchlist,
// alert rules, alerts and preferences live in this browser (localStorage).
import type { AlertRecord, AlertRule, FilingRef, RadarCandidate, WatchItem } from '../../shared/types.ts';
import { filterRadar, pageExplore, type RadarFilter } from '../../shared/views.ts';
import { readLocal, writeLocal } from '../storage.ts';

interface Candidate {
  dedupeKey: string; title: string; body: string; triggerEvent: string; source: string; accession: string | null; sourceUrl: string | null;
  filingAcceptedAt: string | null; limitations: string[]; origin: 'sec' | 'demo';
  meta?: { kind?: string; shareChangePct?: number | null; value?: number | null; items?: string[]; relevance?: number };
}
interface Snapshot {
  now: string;
  get: Record<string, any>;
  explore: Record<string, any>;
  compareInvestors: Record<string, any>;
  stockSides: Record<string, any>;
  alertMatches: Record<string, Candidate[]>;
}
interface State { watch: WatchItem[]; rules: AlertRule[]; alerts: (AlertRecord & { dedupeKey: string })[]; nextId: number; prefs: Record<string, string> }

export class MockError extends Error { constructor(public status: number, message: string) { super(message); } }

let snap: Snapshot | null = null;
function snapshot(): Snapshot {
  if (!snap) snap = JSON.parse(document.getElementById('quarry-snapshot')!.textContent!) as Snapshot;
  return snap;
}
export const snapshotNow = () => snapshot().now;

const KEY = 'quarry.preview.v1';
let state: State | null = null;
function st(): State {
  if (!state) {
    try { state = JSON.parse(readLocal(KEY) ?? '') as State; } catch { state = null; }
    if (!state || !Array.isArray(state.watch)) state = { watch: [], rules: [], alerts: [], nextId: 1, prefs: {} };
  }
  return state;
}
const save = () => writeLocal(KEY, JSON.stringify(st()));
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const nowIso = () => new Date().toISOString();

const allFilings = (): FilingRef[] => snapshot().get['/api/filings?limit=100'].filings;
const stocks = (): { cik: string; ticker: string | null; name: string }[] => snapshot().get['/api/stocks'].stocks;
const investors = (): { cik: string; name: string }[] => snapshot().get['/api/investors'].investors;
const findStock = (id: string) => stocks().find((s) => s.ticker?.toUpperCase() === id.toUpperCase() || s.cik === id.padStart(10, '0'));
const watched = (kind: WatchItem['kind']) => new Set(st().watch.filter((w) => w.kind === kind).map((w) => w.id));

function watchActivity(days: number, limit: number): FilingRef[] {
  const ids = new Set([...watched('stock'), ...watched('manager')]);
  const since = new Date(Date.parse(snapshot().now) - days * 86_400_000).toISOString();
  return allFilings().filter((f) => (ids.has(f.filerCik) || (f.subjectCik && ids.has(f.subjectCik))) && f.acceptedAt > since).slice(0, limit);
}
const flagWatch = (cs: RadarCandidate[]) => { const w = watched('stock'); return cs.map((c) => ({ ...c, onWatchlist: w.has(c.issuerCik) })); };

const RULE_DEFAULTS: Record<string, number | null> = { share_change: 0.25, insider_purchase: 0 };

function evaluate(): { created: number; skippedDuplicates: number } {
  let created = 0, skipped = 0;
  const s = st();
  for (const r of s.rules.filter((x) => x.enabled)) {
    const matches = snapshot().alertMatches[`${r.type}|${r.targetKind}|${r.targetId ?? ''}`] ?? [];
    const threshold = r.threshold ?? RULE_DEFAULTS[r.type] ?? null;
    for (const c of matches) {
      const m = c.meta ?? {};
      if (r.type === 'share_change' && !(m.kind === 'new' || m.kind === 'exited' || Math.abs(m.shareChangePct ?? 0) >= (threshold ?? 0.25))) continue;
      if (r.type === 'insider_purchase' && (m.value ?? 0) < (threshold ?? 0)) continue;
      if (r.type === 'corporate_event' && !(r.eventItems.length ? (m.items ?? []).some((i) => r.eventItems.includes(i)) : (m.relevance ?? 0) >= 0.6)) continue;
      if (s.alerts.some((a) => a.ruleId === r.id && a.dedupeKey === c.dedupeKey)) { skipped++; continue; }
      s.alerts.unshift({
        id: s.nextId++, ruleId: r.id, ruleName: r.name, dedupeKey: c.dedupeKey, title: c.title, body: c.body, triggerEvent: c.triggerEvent, source: c.source,
        accession: c.accession, sourceUrl: c.sourceUrl, filingAcceptedAt: c.filingAcceptedAt, detectedAt: nowIso(), limitations: c.limitations, readAt: null, origin: c.origin,
        deliveryStatus: [
          { channel: 'in_app', status: 'delivered', detail: 'Stored in the in-app alert inbox on this device.' },
          { channel: 'webhook', status: 'not_configured', detail: 'The browser preview has no external delivery.' },
        ],
      });
      created++;
    }
  }
  save();
  return { created, skippedDuplicates: skipped };
}
const alertsView = () => st().alerts.map(({ dedupeKey: _k, ...a }) => { const r = st().rules.find((x) => x.id === a.ruleId); return { ...a, ruleName: r?.name ?? a.ruleName }; });

function validateRule(b: any): Omit<AlertRule, 'id' | 'createdAt' | 'updatedAt'> {
  if (!b || typeof b.name !== 'string' || !b.name.trim()) throw new MockError(400, 'Give the rule a name.');
  if (!['new_filing', 'new_position', 'share_change', 'insider_purchase', 'ownership_disclosure', 'corporate_event'].includes(b.type)) throw new MockError(400, 'Unknown rule type.');
  let targetId: string | null = null;
  if (b.targetKind === 'stock') { const s = findStock(String(b.targetId ?? '')); if (!s) throw new MockError(404, 'stock not found'); targetId = s.cik; }
  else if (b.targetKind === 'manager') { const m = investors().find((i) => i.cik === String(b.targetId ?? '').padStart(10, '0')); if (!m) throw new MockError(404, 'manager not found'); targetId = m.cik; }
  else if (b.targetKind !== 'any') throw new MockError(400, 'Invalid target.');
  return { name: b.name.trim().slice(0, 80), type: b.type, targetKind: b.targetKind, targetId, threshold: typeof b.threshold === 'number' ? b.threshold : null, eventItems: Array.isArray(b.eventItems) ? b.eventItems : [], enabled: b.enabled !== false };
}

export async function handle(method: string, path: string, body: any): Promise<unknown> {
  const url = new URL(path, 'http://preview.local');
  const p = url.pathname;
  const q = Object.fromEntries(url.searchParams);
  const S = snapshot();
  const s = st();
  const notFound = (what = 'Not found') => { throw new MockError(404, what); };
  let m: RegExpExecArray | null;

  if (method === 'GET') {
    if (p === '/api/status') return S.get['/api/status'];
    if (p === '/api/meta') return S.get['/api/meta'];
    if (p === '/api/home') {
      const h = clone(S.get['/api/home']);
      h.radarHighlights = flagWatch(h.radarHighlights);
      h.watchlist = { items: s.watch, activity: watchActivity(30, 12), unreadAlerts: s.alerts.filter((a) => !a.readAt).length };
      return h;
    }
    if (p === '/api/radar') {
      const r = clone(S.get['/api/radar']);
      const all = flagWatch(r.candidates);
      const f: RadarFilter = { ...q, minCap: q.minCap ? Number(q.minCap) : undefined, maxCap: q.maxCap ? Number(q.maxCap) : undefined } as RadarFilter;
      return { ...r, candidates: filterRadar(all, f, watched('category')), total: all.length, watchedCategories: [...watched('category')] };
    }
    if (p === '/api/explore') {
      const preset = q.preset ?? 'new_positions';
      const opts = { q: q.q, sector: q.sector, sort: (q.sort ?? 'metric') as 'metric', page: Number(q.page ?? 1), pageSize: Number(q.pageSize ?? 20) };
      if (preset === 'watchlist') {
        const rows = watchActivity(30, 200).map((f) => ({
          id: `w:${f.accession}`, title: `${f.formType} · ${f.subjectName ?? f.filerName ?? f.filerCik}`, subtitle: f.filerName ?? f.filerCik, metric: f.acceptedAt.slice(0, 10), metricLabel: 'accepted',
          sortValue: Date.parse(f.acceptedAt), date: f.acceptedAt, periodOfReport: f.periodOfReport, eventDate: null, qualifiedBecause: 'Filed by or about an item on your watchlist.',
          link: `/filings/${f.accession}`, sector: null, origin: f.origin,
          evidence: [{ kind: 'filing', summary: `${f.formType} accepted ${f.acceptedAt}`, accession: f.accession, acceptedAt: f.acceptedAt, periodOfReport: f.periodOfReport, eventDate: null, sourceUrl: f.sourceUrl, origin: f.origin }],
        }));
        return { preset, rule: 'All filings for followed stocks and managers within 30 days.', label: 'Watchlist developments', period: null, ...pageExplore(rows, opts) };
      }
      const base = S.explore[preset] ?? notFound('Unknown preset');
      return { preset, rule: base.rule, label: base.label, period: base.period, ...pageExplore(base.rows, opts) };
    }
    if (p === '/api/search') {
      const term = (q.q ?? '').trim().toLowerCase();
      if (!term) return { results: [] };
      const st2 = stocks().filter((x) => `${x.ticker} ${x.name} ${x.cik}`.toLowerCase().includes(term)).map((x: any) => ({ kind: 'stock', id: x.ticker ?? x.cik, label: `${x.ticker} · ${x.name}`, sublabel: `${x.sector ?? 'Sector n/a'} · CIK ${x.cik}`, origin: x.origin, exact: x.ticker?.toLowerCase() === term }));
      const iv = investors().filter((x) => `${x.name} ${x.cik}`.toLowerCase().includes(term)).map((x: any) => ({ kind: 'manager', id: x.cik, label: x.name, sublabel: `Investment manager · CIK ${x.cik}`, origin: x.origin, exact: false }));
      return { results: [...st2, ...iv].sort((a, b) => Number(b.exact) - Number(a.exact)).slice(0, 15).map(({ exact: _e, ...r }) => r) };
    }
    if (p === '/api/investors') return S.get['/api/investors'];
    if ((m = /^\/api\/investors\/(\d+)$/.exec(p))) {
      const cik = m[1].padStart(10, '0');
      return S.get[`/api/investors/${cik}${q.period ? `?period=${q.period}` : ''}`] ?? S.get[`/api/investors/${cik}`] ?? notFound('Investor not found');
    }
    if (p === '/api/stocks') return S.get['/api/stocks'];
    if ((m = /^\/api\/stocks\/([^/]+)$/.exec(p))) {
      const stock = findStock(decodeURIComponent(m[1])) ?? notFound('Stock not found');
      return S.get[`/api/stocks/${stock!.ticker}`];
    }
    if (p === '/api/filings') {
      const forms = q.forms ? q.forms.split(',') : null;
      const list = allFilings().filter((f) => !forms || forms.includes(f.baseForm));
      const off = Number(q.offset ?? 0);
      return { filings: list.slice(off, off + Number(q.limit ?? 50)) };
    }
    if ((m = /^\/api\/filings\/([^/]+)$/.exec(p))) return S.get[`/api/filings/${decodeURIComponent(m[1])}`] ?? notFound('Filing not found');
    if (p === '/api/compare') {
      const ids = (q.ids ?? '').split(',').filter(Boolean).slice(0, 4);
      if (ids.length < 2) throw new MockError(400, 'Choose at least two items to compare');
      if (q.type === 'investors') {
        const req = ids.map((i) => i.padStart(10, '0'));
        const sorted = [...req].sort();
        const r = S.compareInvestors[sorted.join(',')] ?? notFound('Investors not found');
        const order = req.map((c) => sorted.indexOf(c));
        const bySide = new Map(r.sides.map((x: any) => [x.cik, x]));
        return { ...r, type: 'investors', sides: req.map((c) => bySide.get(c)), overlap: r.overlap.map((o: any) => ({ ...o, weights: order.map((i) => o.weights[i]) })) };
      }
      const sides = ids.map((i) => findStock(i)).filter(Boolean).map((x) => S.stockSides[x!.ticker!]);
      if (sides.length < 2) notFound('Stocks not found');
      return { type: 'stocks', sides };
    }
    if (p === '/api/watchlist') return { items: s.watch };
    if (p === '/api/alerts/rules') return { rules: s.rules };
    if (p === '/api/alerts') return { alerts: alertsView(), delivery: { inApp: true, webhook: false } };
    if (p === '/api/preferences') return { preferences: s.prefs };
    return notFound();
  }

  if (method === 'POST' && p === '/api/watchlist') {
    const kind = body?.kind as WatchItem['kind'];
    const id = String(body?.id ?? '');
    let item: WatchItem | null = null;
    if (kind === 'stock') { const x = findStock(id) ?? notFound('stock not found'); item = { kind, id: x!.cik, label: `${x!.ticker} · ${x!.name}`, addedAt: nowIso() }; }
    else if (kind === 'manager') { const x = investors().find((i) => i.cik === id.padStart(10, '0')) ?? notFound('manager not found'); item = { kind, id: x!.cik, label: x!.name, addedAt: nowIso() }; }
    else if (kind === 'category') { const c = S.get['/api/meta'].categories[id] ?? notFound('Unknown research category'); item = { kind, id, label: c.label, addedAt: nowIso() }; }
    else throw new MockError(400, 'Invalid request');
    if (!s.watch.some((w) => w.kind === item!.kind && w.id === item!.id)) s.watch.unshift(item!);
    save();
    return { items: s.watch };
  }
  if (method === 'DELETE' && (m = /^\/api\/watchlist\/([^/]+)\/([^/]+)$/.exec(p))) {
    s.watch = s.watch.filter((w) => !(w.kind === m![1] && w.id === decodeURIComponent(m![2])));
    save();
    return { items: s.watch };
  }
  if (method === 'POST' && p === '/api/alerts/rules') {
    const r = validateRule(body);
    s.rules.unshift({ ...r, id: s.nextId++, createdAt: nowIso(), updatedAt: nowIso() });
    evaluate();
    return { rules: s.rules, alerts: alertsView() };
  }
  if ((m = /^\/api\/alerts\/rules\/(\d+)$/.exec(p))) {
    const id = Number(m[1]);
    const i = s.rules.findIndex((r) => r.id === id);
    if (i < 0) notFound('Alert rule not found');
    if (method === 'PUT') { s.rules[i] = { ...s.rules[i], ...validateRule(body), updatedAt: nowIso() }; evaluate(); }
    else if (method === 'DELETE') { s.rules.splice(i, 1); s.alerts = s.alerts.filter((a) => a.ruleId !== id); save(); }
    return { rules: s.rules, alerts: alertsView() };
  }
  if (method === 'POST' && p === '/api/alerts/evaluate') return { ...evaluate(), alerts: alertsView() };
  if (method === 'POST' && (m = /^\/api\/alerts\/(\d+)\/read$/.exec(p))) {
    const a = s.alerts.find((x) => x.id === Number(m![1]));
    if (a && !a.readAt) a.readAt = nowIso();
    save();
    return { alerts: alertsView() };
  }
  if (method === 'POST' && p === '/api/alerts/read-all') { s.alerts.forEach((a) => { a.readAt ??= nowIso(); }); save(); return { alerts: alertsView() }; }
  if (method === 'PUT' && p === '/api/preferences') { Object.assign(s.prefs, body ?? {}); save(); return { preferences: s.prefs }; }
  return notFound();
}
