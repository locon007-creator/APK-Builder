import { analyzeSymbol } from './_lib/analyze.js';
import { hasKey } from './_lib/massive.js';
import { json, error, rateLimited, SYMBOL_RE, numParam } from './_lib/http.js';

export const config = { maxDuration: 30 };

export async function GET(request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  if (!hasKey()) return error('Market data is not configured: set MASSIVE_API_KEY in the Vercel project environment', 503, { code: 'NO_KEY' });

  const url = new URL(request.url);
  const symbol = (url.searchParams.get('symbol') || '').toUpperCase().trim();
  if (!SYMBOL_RE.test(symbol)) return error('Invalid symbol');
  const strategy = url.searchParams.get('strategy') || 'csp';
  if (!['csp', 'cc', 'both'].includes(strategy)) return error('strategy must be csp, cc or both');
  const risk = url.searchParams.get('risk') || 'balanced';
  if (!['conservative', 'balanced', 'aggressive'].includes(risk)) return error('Invalid risk tolerance');

  const dteMin = numParam(url, 'dteMin', 15, 1, 120);
  const dteMax = numParam(url, 'dteMax', 45, dteMin, 180);
  const basisRaw = url.searchParams.get('basis');
  const opts = {
    strategy,
    risk,
    dteMin,
    dteMax,
    capital: numParam(url, 'capital', 50000, 100, 1e9),
    target: numParam(url, 'target', 1.5, 0.1, 20) / 100,
    rate: numParam(url, 'rate', 4, 0, 20) / 100,
    minOI: numParam(url, 'minOI', 100, 0, 1e6),
    maxSpread: numParam(url, 'maxSpread', 12, 1, 100) / 100,
    basis: basisRaw ? numParam(url, 'basis', null, 0.01, 1e6) : null,
  };

  try {
    const result = await analyzeSymbol(symbol, opts);
    const cacheable = result.status !== 'error';
    return json(result, 200, { 'Cache-Control': cacheable ? 'public, s-maxage=90, stale-while-revalidate=180' : 'no-store' });
  } catch (e) {
    return error(e.message || 'Analysis failed', e.status && e.status < 600 ? 502 : 500, { symbol });
  }
}
