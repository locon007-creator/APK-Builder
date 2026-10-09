import express, { type NextFunction, type Request, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { type DB, all, getMeta, one } from './db/index.ts';
import type { AppConfig } from './config.ts';
import type { MarketDataProvider } from './market/provider.ts';
import type { DatasetInfo, RadarCategory, WatchItem } from '../shared/types.ts';
import { resolveAsOf, addDays } from './domain/asof.ts';
import { buildRadar, CATEGORY_META } from './domain/radar.ts';
import { explore, PRESETS, type Preset } from './domain/explore.ts';
import { findIssuer, form4Detail, getEntity, getFiling, listFilings, search, listEvents } from './domain/queries.ts';
import { compareInvestors, compareStocks, investorProfile, listInvestors, listStocks, stockProfile, type Ctx } from './domain/profiles.ts';
import { evaluateAlerts, listAlerts, RULE_TYPE_LABELS, toRule, webhookAdapter, type DeliveryAdapter } from './domain/alerts.ts';
import { ingestionStatus } from './sec/ingest.ts';
import { RANKING_METHOD } from './domain/ranking.ts';
import { FRESHNESS } from './domain/freshness.ts';
import { ITEMS_8K } from './domain/events8k.ts';

declare module 'express-serve-static-core' {
  interface Request { workspaceId: string; asOf: string; now: string }
}

export interface AppDeps {
  db: DB;
  config: AppConfig;
  market: MarketDataProvider;
  clock?: () => Date;
  adapters?: DeliveryAdapter[];
}

const COOKIE = 'quarry_ws';
const VISIT_GAP_MS = 30 * 60_000;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next);
};

export function createApp(deps: AppDeps) {
  const { db, config, market } = deps;
  const clock = deps.clock ?? (() => new Date());
  const adapters = deps.adapters ?? [webhookAdapter(config.alertWebhookUrl)];
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // ---- Workspace (server-side scoping of personal data) -------------------
  app.use('/api', (req, res, next) => {
    const now = clock();
    req.now = now.toISOString();
    try {
      req.asOf = resolveAsOf(req.query.asOf, now);
    } catch (err) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    let id = parseCookies(req.headers.cookie)[COOKIE];
    if (!id || !/^[a-f0-9]{32}$/.test(id) || !one(db, 'SELECT 1 FROM workspaces WHERE id = ?', id)) {
      id = randomBytes(16).toString('hex');
      db.prepare('INSERT INTO workspaces (id, created_at, visit_started_at, last_seen_at) VALUES (?, ?, ?, ?)').run(id, req.now, req.now, req.now);
      res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 400}${config.production ? '; Secure' : ''}`);
    } else {
      // A new "visit" begins after 30 minutes of inactivity; the previous visit start powers "Since your last visit".
      const ws = one<{ visit_started_at: string | null; last_seen_at: string | null }>(db, 'SELECT visit_started_at, last_seen_at FROM workspaces WHERE id = ?', id)!;
      if (!ws.last_seen_at || now.getTime() - Date.parse(ws.last_seen_at) > VISIT_GAP_MS) {
        db.prepare('UPDATE workspaces SET previous_visit_at = visit_started_at, visit_started_at = ?, last_seen_at = ? WHERE id = ?').run(req.now, req.now, id);
      } else {
        db.prepare('UPDATE workspaces SET last_seen_at = ? WHERE id = ?').run(req.now, id);
      }
    }
    req.workspaceId = id;
    next();
  });

  const ctx = (req: Request): Ctx => ({ db, asOf: req.asOf, now: req.now, market });
  const watchItems = (wsId: string): WatchItem[] =>
    all<{ kind: WatchItem['kind']; item_id: string; label: string; added_at: string }>(db, 'SELECT * FROM watch_items WHERE workspace_id = ? ORDER BY added_at DESC', wsId)
      .map((w) => ({ kind: w.kind, id: w.item_id, label: w.label, addedAt: w.added_at }));
  const watchSets = (wsId: string) => {
    const items = watchItems(wsId);
    return { stocks: new Set(items.filter((i) => i.kind === 'stock').map((i) => i.id)), managers: new Set(items.filter((i) => i.kind === 'manager').map((i) => i.id)), categories: new Set(items.filter((i) => i.kind === 'category').map((i) => i.id)) };
  };

  // ---- Status --------------------------------------------------------------
  app.get('/api/status', (req, res) => {
    const latest = one<{ a: string | null; i: string | null }>(db, 'SELECT MAX(accepted_at) AS a, MAX(ingested_at) AS i FROM filings WHERE accepted_at <= ?', req.asOf);
    const info: DatasetInfo = {
      dataset: config.dataset,
      isDemo: config.dataset === 'demo',
      asOf: req.asOf,
      now: req.now,
      latestAcceptedAt: latest?.a ?? null,
      latestIngestedAt: latest?.i ?? null,
      market: market.status(),
      delivery: { inApp: true, webhook: !!config.alertWebhookUrl },
    };
    res.json({ ...info, demoAnchor: getMeta(db, 'demo_anchor'), ingestion: ingestionStatus(db), freshnessThresholds: FRESHNESS });
  });

  app.get('/api/meta', (_req, res) => {
    res.json({ categories: CATEGORY_META, presets: PRESETS, ruleTypes: RULE_TYPE_LABELS, rankingMethod: RANKING_METHOD, items8k: ITEMS_8K, freshness: FRESHNESS });
  });

  // ---- Home ----------------------------------------------------------------
  app.get('/api/home', wrap(async (req, res) => {
    const ws = one<{ previous_visit_at: string | null }>(db, 'SELECT previous_visit_at FROM workspaces WHERE id = ?', req.workspaceId)!;
    const since = ws.previous_visit_at ?? addDays(req.asOf, -7);
    const watch = watchSets(req.workspaceId);
    const radar = await buildRadar({ db, asOf: req.asOf, now: req.now, market, watchIssuers: watch.stocks });
    const sinceLast = listFilings(db, { asOf: req.asOf, now: req.now, since, limit: 30 });
    const watchCiks = [...watch.stocks, ...watch.managers];
    const watchActivity = watchCiks.flatMap((cik) => listFilings(db, { asOf: req.asOf, now: req.now, cik, since: addDays(req.asOf, -30), limit: 10 }))
      .sort((a, b) => b.acceptedAt.localeCompare(a.acceptedAt)).filter((f, i, arr) => arr.findIndex((x) => x.accession === f.accession) === i).slice(0, 12);
    const highlights: typeof radar.candidates = [];
    for (const c of radar.candidates) {
      if (highlights.length >= 6) break;
      if (highlights.filter((h) => h.category === c.category).length >= 2) continue; // keep the mix varied
      highlights.push(c);
    }
    res.json({
      since,
      firstVisit: !ws.previous_visit_at,
      sinceLastVisit: sinceLast,
      radarHighlights: highlights,
      watchlist: { items: watchItems(req.workspaceId), activity: watchActivity, unreadAlerts: (one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM alerts WHERE workspace_id = ? AND read_at IS NULL', req.workspaceId)?.n) ?? 0 },
      recentlyFiled: listFilings(db, { asOf: req.asOf, now: req.now, limit: 10 }),
      period: radar.period,
    });
  }));

  // ---- Radar ---------------------------------------------------------------
  const radarQuery = z.object({
    mode: z.enum(['positioning', 'event', 'all']).optional(),
    category: z.string().optional(),
    sector: z.string().optional(),
    minCap: z.coerce.number().optional(),
    maxCap: z.coerce.number().optional(),
    form: z.string().optional(),
    filedFrom: z.string().optional(),
    filedTo: z.string().optional(),
    period: z.string().optional(),
    institutional: z.enum(['1', '0']).optional(),
    insider: z.enum(['1', '0']).optional(),
    watchlist: z.enum(['1', '0']).optional(),
    market: z.enum(['1', '0']).optional(),
  }).passthrough();

  app.get('/api/radar', wrap(async (req, res) => {
    const q = radarQuery.parse(req.query);
    const watch = watchSets(req.workspaceId);
    const radar = await buildRadar({ db, asOf: req.asOf, now: req.now, market, watchIssuers: watch.stocks });
    const sectors = [...new Set(radar.candidates.map((c) => c.sector).filter(Boolean))].sort() as string[];
    const cats = q.category ? new Set(q.category.split(',')) : null;
    const insiderIssuers = new Set(radar.candidates.filter((c) => c.category === 'insider_buying').map((c) => c.issuerCik));
    const instIssuers = new Set(radar.candidates.filter((c) => c.mode === 'positioning' && c.category !== 'institutional_reduction').map((c) => c.issuerCik));
    const filtered = radar.candidates.filter((c) =>
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
      (q.watchlist !== '1' || c.onWatchlist || watch.categories.has(c.category)) &&
      (q.market !== '1' || c.hasMarketConfirmation));
    res.json({ ...radar, candidates: filtered, total: radar.candidates.length, sectors, watchedCategories: [...watch.categories] });
  }));

  // ---- Explore -------------------------------------------------------------
  app.get('/api/explore', (req, res) => {
    const q = z.object({
      preset: z.enum(Object.keys(PRESETS) as [Preset, ...Preset[]]).default('new_positions'),
      q: z.string().optional(),
      sector: z.string().optional(),
      sort: z.enum(['metric', 'newest', 'name']).default('metric'),
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(5).max(100).default(20),
    }).parse(req.query);
    const { rows, period } = explore(db, q.preset, req.asOf, watchSets(req.workspaceId));
    const term = q.q?.trim().toLowerCase();
    const filtered = rows.filter((r) => (!term || `${r.title} ${r.subtitle}`.toLowerCase().includes(term)) && (!q.sector || r.sector === q.sector));
    filtered.sort((a, b) => q.sort === 'newest' ? b.date.localeCompare(a.date) : q.sort === 'name' ? a.title.localeCompare(b.title) : b.sortValue - a.sortValue || a.id.localeCompare(b.id));
    const start = (q.page - 1) * q.pageSize;
    res.json({
      preset: q.preset, rule: PRESETS[q.preset].rule, label: PRESETS[q.preset].label, period,
      total: filtered.length, page: q.page, pageSize: q.pageSize, pages: Math.max(1, Math.ceil(filtered.length / q.pageSize)),
      rows: filtered.slice(start, start + q.pageSize),
      sectors: [...new Set(rows.map((r) => r.sector).filter(Boolean))].sort(),
    });
  });

  app.get('/api/search', (req, res) => {
    res.json({ results: search(db, String(req.query.q ?? ''), 15) });
  });

  // ---- Investors / stocks / filings ---------------------------------------
  app.get('/api/investors', (req, res) => res.json({ investors: listInvestors(ctx(req)) }));
  app.get('/api/investors/:cik', (req, res) => {
    const cik = String(req.params.cik).padStart(10, '0');
    const p = investorProfile(ctx(req), cik, typeof req.query.period === 'string' ? req.query.period : undefined);
    if (!p) throw new HttpError(404, 'Investor not found');
    res.json(p);
  });

  app.get('/api/stocks', (req, res) => res.json({ stocks: listStocks(ctx(req)) }));
  app.get('/api/stocks/:id', wrap(async (req, res) => {
    const issuer = findIssuer(db, String(req.params.id));
    if (!issuer) throw new HttpError(404, 'Stock not found');
    res.json(await stockProfile(ctx(req), issuer));
  }));

  app.get('/api/filings', (req, res) => {
    const forms = typeof req.query.forms === 'string' && req.query.forms ? req.query.forms.split(',') : undefined;
    const limit = Math.min(100, Number(req.query.limit ?? 50));
    const offset = Math.max(0, Number(req.query.offset ?? 0));
    res.json({ filings: listFilings(db, { asOf: req.asOf, now: req.now, forms, cik: typeof req.query.cik === 'string' ? req.query.cik : undefined, limit, offset }) });
  });

  app.get('/api/filings/:accession', (req, res) => {
    const f = getFiling(db, String(req.params.accession), req.now);
    if (!f || f.acceptedAt > req.asOf) throw new HttpError(404, 'Filing not found (or not yet accepted as of the selected cutoff)');
    const holdings = f.baseForm === '13F-HR' ? all(db, `SELECT h.cusip, h.name_of_issuer AS name, h.title_of_class AS titleOfClass, h.shares, h.value_usd AS value, h.sh_prn_type AS shPrnType, h.put_call AS putCall, s.ticker, s.mapping_source AS mapping FROM holdings_13f h LEFT JOIN securities s ON s.cusip = h.cusip WHERE h.accession = ? ORDER BY h.value_usd DESC`, f.accession) : [];
    const form4 = f.baseForm === '4' ? form4Detail(db, f.accession, req.asOf) : { transactions: [], supersededBy: null };
    const event = ['8-K', 'SC 13D', 'SC 13G'].includes(f.baseForm) ? listEvents(db, { asOf: req.asOf, issuerCik: f.subjectCik ?? undefined }).find((e) => e.accession === f.accession) ?? null : null;
    const related = all<{ accession: string; form_type: string; accepted_at: string; amendment_type: string | null }>(db,
      `SELECT accession, form_type, accepted_at, amendment_type FROM filings WHERE filer_cik = ? AND base_form = ? AND COALESCE(subject_cik,'') = COALESCE(?, '') AND COALESCE(period_of_report,'') = COALESCE(?, '') AND accession != ? AND accepted_at <= ? ORDER BY accepted_at`,
      f.filerCik, f.baseForm, f.subjectCik, f.periodOfReport, f.accession, req.asOf);
    res.json({
      filing: f,
      holdings, transactions: form4.transactions, supersededBy: form4.supersededBy, event, related,
      parseRuns: all(db, 'SELECT parser_version AS parserVersion, status, row_count AS rowCount, message, ran_at AS ranAt, superseded_rows AS supersededRows FROM parse_runs WHERE accession = ? ORDER BY id', f.accession),
    });
  });

  // ---- Compare -------------------------------------------------------------
  app.get('/api/compare', wrap(async (req, res) => {
    const q = z.object({ type: z.enum(['investors', 'stocks']), ids: z.string().min(1) }).parse(req.query);
    const ids = q.ids.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4);
    if (ids.length < 2) throw new HttpError(400, 'Choose at least two items to compare');
    if (q.type === 'investors') {
      res.json({ type: 'investors', ...compareInvestors(ctx(req), ids.map((i) => i.padStart(10, '0'))) });
    } else {
      const issuers = ids.map((i) => findIssuer(db, i)).filter((x): x is NonNullable<typeof x> => !!x);
      if (issuers.length < 2) throw new HttpError(404, 'Stocks not found');
      res.json({ type: 'stocks', ...(await compareStocks(ctx(req), issuers)) });
    }
  }));

  // ---- Watchlist -----------------------------------------------------------
  app.get('/api/watchlist', (req, res) => res.json({ items: watchItems(req.workspaceId) }));
  app.post('/api/watchlist', (req, res) => {
    const body = z.object({ kind: z.enum(['stock', 'manager', 'category']), id: z.string().min(1).max(64) }).parse(req.body);
    let label: string;
    let id = body.id;
    if (body.kind === 'category') {
      const meta = CATEGORY_META[body.id as RadarCategory];
      if (!meta) throw new HttpError(400, 'Unknown research category');
      label = meta.label;
    } else {
      const e = body.kind === 'stock' ? findIssuer(db, body.id) : getEntity(db, body.id.padStart(10, '0'));
      if (!e || (body.kind === 'manager' && e.kind !== 'manager')) throw new HttpError(404, `${body.kind} not found`);
      id = e.cik;
      label = body.kind === 'stock' ? `${e.ticker ?? ''} · ${e.name}` : e.name;
    }
    db.prepare('INSERT OR IGNORE INTO watch_items (workspace_id, kind, item_id, label, added_at) VALUES (?, ?, ?, ?, ?)').run(req.workspaceId, body.kind, id, label, req.now);
    res.status(201).json({ items: watchItems(req.workspaceId) });
  });
  app.delete('/api/watchlist/:kind/:id', (req, res) => {
    db.prepare('DELETE FROM watch_items WHERE workspace_id = ? AND kind = ? AND item_id = ?').run(req.workspaceId, req.params.kind, req.params.id);
    res.json({ items: watchItems(req.workspaceId) });
  });

  // ---- Alerts --------------------------------------------------------------
  const ruleBody = z.object({
    name: z.string().trim().min(1).max(80),
    type: z.enum(Object.keys(RULE_TYPE_LABELS) as [string, ...string[]]),
    targetKind: z.enum(['stock', 'manager', 'any']),
    targetId: z.string().max(64).nullable().optional(),
    threshold: z.number().min(0).max(1e12).nullable().optional(),
    eventItems: z.array(z.string().regex(/^\d\.\d{2}$/)).max(20).optional(),
    enabled: z.boolean().optional(),
  });
  const resolveTarget = (kind: string, id: string | null | undefined) => {
    if (kind === 'any') return null;
    if (!id) throw new HttpError(400, 'Target required');
    const e = kind === 'stock' ? findIssuer(db, id) : getEntity(db, id.padStart(10, '0'));
    if (!e || (kind === 'manager' && e.kind !== 'manager')) throw new HttpError(404, `${kind} not found`);
    return e.cik;
  };
  const rulesFor = (wsId: string) => all<Parameters<typeof toRule>[0]>(db, 'SELECT * FROM alert_rules WHERE workspace_id = ? ORDER BY id DESC', wsId).map(toRule);
  const ownRule = (req: Request) => {
    const r = one<{ id: number }>(db, 'SELECT id FROM alert_rules WHERE id = ? AND workspace_id = ?', Number(req.params.id), req.workspaceId);
    if (!r) throw new HttpError(404, 'Alert rule not found');
    return r.id;
  };

  app.get('/api/alerts/rules', (req, res) => res.json({ rules: rulesFor(req.workspaceId) }));
  app.post('/api/alerts/rules', wrap(async (req, res) => {
    const b = ruleBody.parse(req.body);
    const target = resolveTarget(b.targetKind, b.targetId);
    db.prepare(`INSERT INTO alert_rules (workspace_id, name, type, target_kind, target_id, threshold, event_items, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.workspaceId, b.name, b.type, b.targetKind, target, b.threshold ?? null, (b.eventItems ?? []).join(','), b.enabled === false ? 0 : 1, req.now, req.now);
    await evaluateAlerts(db, { now: req.now, workspaceId: req.workspaceId, adapters });
    res.status(201).json({ rules: rulesFor(req.workspaceId), alerts: listAlerts(db, req.workspaceId) });
  }));
  app.put('/api/alerts/rules/:id', wrap(async (req, res) => {
    const id = ownRule(req);
    const b = ruleBody.parse(req.body);
    const target = resolveTarget(b.targetKind, b.targetId);
    db.prepare(`UPDATE alert_rules SET name = ?, type = ?, target_kind = ?, target_id = ?, threshold = ?, event_items = ?, enabled = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .run(b.name, b.type, b.targetKind, target, b.threshold ?? null, (b.eventItems ?? []).join(','), b.enabled === false ? 0 : 1, req.now, id, req.workspaceId);
    await evaluateAlerts(db, { now: req.now, workspaceId: req.workspaceId, adapters });
    res.json({ rules: rulesFor(req.workspaceId), alerts: listAlerts(db, req.workspaceId) });
  }));
  app.delete('/api/alerts/rules/:id', (req, res) => {
    const id = ownRule(req);
    db.prepare('DELETE FROM alerts WHERE rule_id = ? AND workspace_id = ?').run(id, req.workspaceId);
    db.prepare('DELETE FROM alert_rules WHERE id = ? AND workspace_id = ?').run(id, req.workspaceId);
    res.json({ rules: rulesFor(req.workspaceId), alerts: listAlerts(db, req.workspaceId) });
  });
  app.get('/api/alerts', (req, res) => res.json({ alerts: listAlerts(db, req.workspaceId), delivery: { inApp: true, webhook: adapters.some((a) => a.configured) } }));
  app.post('/api/alerts/evaluate', wrap(async (req, res) => {
    const r = await evaluateAlerts(db, { now: req.now, workspaceId: req.workspaceId, adapters });
    res.json({ ...r, alerts: listAlerts(db, req.workspaceId) });
  }));
  app.post('/api/alerts/:id/read', (req, res) => {
    db.prepare('UPDATE alerts SET read_at = COALESCE(read_at, ?) WHERE id = ? AND workspace_id = ?').run(req.now, Number(req.params.id), req.workspaceId);
    res.json({ alerts: listAlerts(db, req.workspaceId) });
  });
  app.post('/api/alerts/read-all', (req, res) => {
    db.prepare('UPDATE alerts SET read_at = ? WHERE workspace_id = ? AND read_at IS NULL').run(req.now, req.workspaceId);
    res.json({ alerts: listAlerts(db, req.workspaceId) });
  });

  // ---- Preferences ---------------------------------------------------------
  const PREF_KEYS = ['theme', 'radarMode', 'radarCategory', 'explorePreset', 'asOf', 'density'] as const;
  app.get('/api/preferences', (req, res) => {
    const rows = all<{ key: string; value: string }>(db, 'SELECT key, value FROM preferences WHERE workspace_id = ?', req.workspaceId);
    res.json({ preferences: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  });
  app.put('/api/preferences', (req, res) => {
    const body = z.record(z.enum(PREF_KEYS), z.string().max(64)).parse(req.body);
    const stmt = db.prepare('INSERT INTO preferences (workspace_id, key, value) VALUES (?, ?, ?) ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(body)) stmt.run(req.workspaceId, k, v);
    const rows = all<{ key: string; value: string }>(db, 'SELECT key, value FROM preferences WHERE workspace_id = ?', req.workspaceId);
    res.json({ preferences: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // ---- Static client (production build) -----------------------------------
  const dist = resolve('dist');
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err instanceof RangeError) return res.status(400).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Internal error' });
  });

  return app;
}
