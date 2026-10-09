// Export a self-contained snapshot of the demo API for the static preview build.
// Every response comes from the real server code running on a fresh demo dataset.
import { writeFileSync, mkdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db/index.ts';
import { seedDemo } from '../demo/seed.ts';
import { createApp } from '../app.ts';
import { loadConfig } from '../config.ts';
import { DemoMarketDataProvider } from '../market/demo.ts';
import { PRESETS } from '../domain/explore.ts';
import { matchRule, type Candidate } from '../domain/alerts.ts';
import { ITEMS_8K } from '../domain/events8k.ts';
import type { AlertRule, AlertRuleType } from '../../shared/types.ts';

const now = new Date();
const nowIso = now.toISOString();
const db = openDb(':memory:');
seedDemo(db, now);
const app = createApp({ db, config: { ...loadConfig({}), dataset: 'demo' }, market: new DemoMarketDataProvider(db), clock: () => now, adapters: [] });
const server = await new Promise<import('node:http').Server>((r) => { const s = app.listen(0, () => r(s)); });
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
let cookie = '';
const get = async (path: string) => {
  const res = await fetch(base + path, { headers: cookie ? { cookie } : {} });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
};

const out: { now: string; get: Record<string, unknown>; explore: Record<string, unknown>; compareInvestors: Record<string, unknown>; stockSides: Record<string, unknown>; alertMatches: Record<string, Candidate[]> } =
  { now: nowIso, get: {}, explore: {}, compareInvestors: {}, stockSides: {}, alertMatches: {} };
const put = async (path: string) => { out.get[path] = await get(path); return out.get[path] as any; };

await put('/api/status');
await put('/api/meta');
await put('/api/home');
await put('/api/radar');
await put('/api/alerts');
const filings = await put('/api/filings?limit=100');
for (const f of filings.filings) await put(`/api/filings/${f.accession}`);
const investors = (await put('/api/investors')).investors as { cik: string }[];
for (const i of investors) {
  const p = await put(`/api/investors/${i.cik}`);
  for (const period of p.periods) out.get[`/api/investors/${i.cik}?period=${period}`] = await get(`/api/investors/${i.cik}?period=${period}`);
}
const stocks = (await put('/api/stocks')).stocks as { cik: string; ticker: string }[];
for (const s of stocks) await put(`/api/stocks/${s.ticker}`);
for (const preset of Object.keys(PRESETS)) if (preset !== 'watchlist') out.explore[preset] = await get(`/api/explore?preset=${preset}&pageSize=100`);

// Investor comparisons: every combination of 2–4, keyed by sorted CIKs.
const ciks = investors.map((i) => i.cik).sort();
const combos: string[][] = [];
const rec = (start: number, acc: string[]) => { if (acc.length >= 2) combos.push([...acc]); if (acc.length === 4) return; for (let i = start; i < ciks.length; i++) rec(i + 1, [...acc, ciks[i]]); };
rec(0, []);
for (const c of combos) out.compareInvestors[c.join(',')] = await get(`/api/compare?type=investors&ids=${c.join(',')}`);
// Stock comparison sides are independent of each other.
for (let i = 0; i < stocks.length; i++) {
  const other = stocks[(i + 1) % stocks.length].ticker;
  const r = await get(`/api/compare?type=stocks&ids=${stocks[i].ticker},${other}`);
  out.stockSides[stocks[i].ticker] = r.sides[0];
}

// Alert matches for every rule type × target, with the widest thresholds (the preview narrows them).
const types: AlertRuleType[] = ['new_filing', 'new_position', 'share_change', 'insider_purchase', 'ownership_disclosure', 'corporate_event'];
for (const type of types) {
  const targets: [AlertRule['targetKind'], string | null][] = [['any', null], ...stocks.map((s) => ['stock', s.cik] as [AlertRule['targetKind'], string])];
  if (['new_filing', 'new_position', 'share_change'].includes(type)) targets.push(...investors.map((i) => ['manager', i.cik] as [AlertRule['targetKind'], string]));
  for (const [targetKind, targetId] of targets) {
    const rule: AlertRule = { id: 0, name: '', type, targetKind, targetId, threshold: 0, eventItems: type === 'corporate_event' ? Object.keys(ITEMS_8K) : [], enabled: true, createdAt: nowIso, updatedAt: nowIso };
    out.alertMatches[`${type}|${targetKind}|${targetId ?? ''}`] = matchRule(db, rule, nowIso);
  }
}
server.close();
mkdirSync('dist-static', { recursive: true });
const json = JSON.stringify(out);
writeFileSync('dist-static/snapshot.json', json);
console.log(`snapshot: ${Object.keys(out.get).length} responses, ${combos.length} investor comparisons, ${(json.length / 1e6).toFixed(2)} MB`);
