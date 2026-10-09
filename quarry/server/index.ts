import { loadConfig } from './config.ts';
import { openDb } from './db/index.ts';
import { createApp } from './app.ts';
import { createMarketProvider } from './market/index.ts';
import { seedDemo } from './demo/seed.ts';
import { getMeta } from './db/index.ts';

const config = loadConfig();
const db = openDb(config.dbPath);

if (config.dataset === 'demo' && !getMeta(db, 'demo_anchor')) {
  const s = seedDemo(db, new Date());
  console.log(`[quarry] Seeded fictional demo dataset (${s.filings} filings, periods ${s.periods.join(', ')}).`);
}
if (config.dataset === 'sec' && getMeta(db, 'dataset') === 'demo') {
  throw new Error(`Refusing to serve SEC mode from a demo database (${config.dbPath}).`);
}

const market = createMarketProvider(config, db);
const app = createApp({ db, config, market });
app.listen(config.port, () => {
  console.log(`[quarry] API listening on http://localhost:${config.port} — dataset: ${config.dataset.toUpperCase()}${config.dataset === 'demo' ? ' (fictional, clearly labelled)' : ''}; market data: ${market.status().name}`);
});
