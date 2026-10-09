import { loadConfig } from '../config.ts';
import { openDb } from '../db/index.ts';
import { evaluateAlerts, webhookAdapter } from '../domain/alerts.ts';

const config = loadConfig();
const db = openDb(config.dbPath);
const r = await evaluateAlerts(db, { now: new Date().toISOString(), adapters: [webhookAdapter(config.alertWebhookUrl)] });
console.log(`[alerts] ${r.created} new alert(s), ${r.skippedDuplicates} duplicate(s) suppressed`);
