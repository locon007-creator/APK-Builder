import { readFileSync } from 'node:fs';
import { loadConfig } from '../config.ts';
import { getMeta, openDb } from '../db/index.ts';
import { SecClient } from '../sec/client.ts';
import { ingest, type Universe } from '../sec/ingest.ts';
import { evaluateAlerts, webhookAdapter } from '../domain/alerts.ts';

const config = loadConfig({ ...process.env, QUARRY_DATASET: 'sec' });
const db = openDb(config.dbPath);
if (getMeta(db, 'dataset') === 'demo') throw new Error(`${config.dbPath} is a demo database; refusing to mix SEC data into it.`);
const universe = JSON.parse(readFileSync(config.universePath, 'utf8')) as Universe;
const only = process.argv.slice(2).filter((a) => ['13f', 'events', 'fundamentals'].includes(a)) as ('13f' | 'events' | 'fundamentals')[];
const client = new SecClient({ userAgent: config.secUserAgent, maxRps: config.secMaxRps, log: (m) => console.log(`[sec] ${m}`) });

const s = await ingest({ db, client, universe, only: only.length ? only : undefined, log: (m) => console.log(`[ingest] ${m}`) });
console.log(`[ingest] run ${s.runId}: seen ${s.seen}, new ${s.created}, reparsed ${s.reparsed}, unchanged ${s.unchanged}, errors ${s.errors} (${client.requests} SEC requests)`);
const a = await evaluateAlerts(db, { now: new Date().toISOString(), adapters: [webhookAdapter(config.alertWebhookUrl)] });
console.log(`[alerts] ${a.created} new alert(s), ${a.skippedDuplicates} duplicate(s) suppressed`);
