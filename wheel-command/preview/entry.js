// Standalone preview: runs the real API handlers and scoring engine in the
// browser against the simulated upstream from tests/. Never used in production.
import './shim.js';
import '../tests/mock-upstream.js';
import * as analyze from '../api/analyze.js';
import * as health from '../api/health.js';
import * as universe from '../api/universe.js';
import * as market from '../api/market.js';
import * as quotes from '../api/quotes.js';

const routes = { analyze, health, universe, market, quotes };
const upstream = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = typeof input === 'string' ? input : input.url;
  const m = u.match(/^\/api\/([a-z]+)/);
  if (!m) return upstream(input, init);
  await new Promise((r) => setTimeout(r, 60 + Math.random() * 140));
  return routes[m[1]].GET(new Request(new URL(u, 'https://preview.local')));
};
await import('../public/app.js');
