import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDb } from '../server/db/index.ts';
import { seedDemo } from '../server/demo/seed.ts';
import { createApp } from '../server/app.ts';
import { loadConfig } from '../server/config.ts';
import { DemoMarketDataProvider } from '../server/market/demo.ts';

const anchor = new Date('2026-10-09T02:00:00.000Z');
let server: Server;
let base = '';

class Client {
  cookie = '';
  async req(method: string, path: string, body?: unknown) {
    const res = await fetch(base + path, { method, headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    return { status: res.status, json: await res.json() as any };
  }
  get = (p: string) => this.req('GET', p);
}

beforeAll(async () => {
  const db = openDb(':memory:');
  seedDemo(db, anchor);
  const app = createApp({ db, config: { ...loadConfig({}), dataset: 'demo' }, market: new DemoMarketDataProvider(db), clock: () => anchor, adapters: [] });
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe('API', () => {
  it('reports dataset status with demo labelling', async () => {
    const { json } = await new Client().get('/api/status');
    expect(json).toMatchObject({ dataset: 'demo', isDemo: true, market: { isDemo: true } });
  });
  it('serves home, radar, explore, search, investor, stock, filing and compare', async () => {
    const c = new Client();
    const home = await c.get('/api/home');
    expect(home.json.radarHighlights.length).toBeGreaterThan(0);
    expect(home.json.recentlyFiled.length).toBeGreaterThan(0);
    const radar = await c.get('/api/radar?mode=event&category=insider_buying');
    expect(radar.json.candidates.every((x: any) => x.category === 'insider_buying')).toBe(true);
    const sector = await c.get('/api/radar?sector=Financials');
    expect(sector.json.candidates.every((x: any) => x.sector === 'Financials')).toBe(true);
    const ex = await c.get('/api/explore?preset=recent_insider_purchases&sort=metric');
    expect(ex.json.rows.length).toBeGreaterThan(0);
    expect(ex.json.rows[0].qualifiedBecause).toMatch(/code P/);
    expect((await c.get('/api/explore?preset=new_positions&pageSize=5&page=1')).json.rows.length).toBeLessThanOrEqual(5);
    const s = await c.get('/api/search?q=aur');
    expect(s.json.results[0]).toMatchObject({ kind: 'stock', id: 'AURS' });
    const inv = await c.get('/api/investors/9000000005');
    expect(inv.json.filing.amendments[0].type).toBe('NEW HOLDINGS');
    const stock = await c.get('/api/stocks/IBBK');
    expect(stock.json.insider.summary.openMarketBuys).toBe(4);
    expect(stock.json.market.quote.isDemo).toBe(true);
    const acc = stock.json.timeline[0].accession;
    expect((await c.get(`/api/filings/${acc}`)).json.parseRuns.length).toBeGreaterThan(0);
    const cmp = await c.get('/api/compare?type=investors&ids=9000000001,9000000002');
    expect(cmp.json.sides).toHaveLength(2);
    expect((await c.get('/api/compare?type=stocks&ids=AURS,QSMI')).json.sides).toHaveLength(2);
  });
  it('validates input and returns clean errors', async () => {
    const c = new Client();
    expect((await c.get('/api/radar?asOf=garbage')).status).toBe(400);
    expect((await c.get('/api/stocks/NOPE')).status).toBe(404);
    expect((await c.get('/api/compare?type=stocks&ids=AURS')).status).toBe(400);
    expect((await c.req('POST', '/api/watchlist', { kind: 'stock' })).status).toBe(400);
    expect((await c.req('POST', '/api/alerts/rules', { name: 'x', type: 'nope', targetKind: 'any' })).status).toBe(400);
  });
  it('applies the historical cutoff to filing lookups', async () => {
    const c = new Client();
    const recent = (await c.get('/api/filings?limit=1')).json.filings[0];
    expect((await c.get(`/api/filings/${recent.accession}?asOf=2026-01-01`)).status).toBe(404);
  });
  it('persists watchlists and alert rules per workspace, enforced server-side', async () => {
    const a = new Client();
    const b = new Client();
    await a.get('/api/status');
    await b.get('/api/status');
    expect(a.cookie).not.toBe(b.cookie);
    expect((await a.req('POST', '/api/watchlist', { kind: 'stock', id: 'IBBK' })).status).toBe(201);
    await a.req('POST', '/api/watchlist', { kind: 'category', id: 'insider_buying' });
    expect((await a.get('/api/watchlist')).json.items).toHaveLength(2);
    expect((await b.get('/api/watchlist')).json.items).toHaveLength(0);
    expect((await a.get('/api/radar')).json.candidates.some((c: any) => c.onWatchlist)).toBe(true);

    const created = await a.req('POST', '/api/alerts/rules', { name: 'IBBK buys', type: 'insider_purchase', targetKind: 'stock', targetId: 'IBBK', threshold: 0 });
    expect(created.status).toBe(201);
    const rule = created.json.rules[0];
    expect(created.json.alerts.length).toBeGreaterThan(0);
    expect(created.json.alerts[0].deliveryStatus[0]).toMatchObject({ channel: 'in_app', status: 'delivered' });
    // B can neither see, edit nor delete A's rule.
    expect((await b.get('/api/alerts/rules')).json.rules).toHaveLength(0);
    expect((await b.req('PUT', `/api/alerts/rules/${rule.id}`, { ...rule, name: 'hijack' })).status).toBe(404);
    expect((await b.req('DELETE', `/api/alerts/rules/${rule.id}`)).status).toBe(404);
    // A edits and re-evaluates without duplicates.
    const before = (await a.get('/api/alerts')).json.alerts.length;
    const edited = await a.req('PUT', `/api/alerts/rules/${rule.id}`, { ...rule, name: 'IBBK insider buys' });
    expect(edited.json.rules[0].name).toBe('IBBK insider buys');
    expect((await a.req('POST', '/api/alerts/evaluate')).json.created).toBe(0);
    expect((await a.get('/api/alerts')).json.alerts.length).toBe(before);
    expect((await a.req('DELETE', `/api/alerts/rules/${rule.id}`)).json.rules).toHaveLength(0);
    expect((await a.get('/api/alerts')).json.alerts).toHaveLength(0);
  });
  it('rejects forged workspace cookies by issuing a fresh workspace', async () => {
    const c = new Client();
    c.cookie = 'quarry_ws=' + 'a'.repeat(32);
    await c.get('/api/watchlist');
    expect(c.cookie).not.toBe('quarry_ws=' + 'a'.repeat(32));
  });
});
