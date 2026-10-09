import { rmSync } from 'node:fs';
import { openDb } from '../db/index.ts';
import { loadConfig } from '../config.ts';
import { seedDemo } from '../demo/seed.ts';

const config = loadConfig({ ...process.env, QUARRY_DATASET: 'demo' });
const path = process.env.QUARRY_DB_PATH ?? config.dbPath;
for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
const db = openDb(path);
const anchor = process.env.DEMO_ANCHOR ? new Date(process.env.DEMO_ANCHOR) : new Date();
const s = seedDemo(db, anchor);
console.log(`Demo dataset written to ${path}`);
console.log(`  anchor ${s.anchor}; 13F periods ${s.periods.join(', ')}; ${s.filings} filings; ${s.prices} price bars`);
console.log('  All companies, managers, people, filings and prices are FICTIONAL.');
