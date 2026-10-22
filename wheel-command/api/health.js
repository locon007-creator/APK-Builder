import { hasKey, get, UpstreamError } from './_lib/massive.js';
import { json } from './_lib/http.js';

// Reports configuration and which data entitlements the key can reach.
export async function GET() {
  if (!hasKey()) return json({ configured: false, provider: 'Massive.com' }, 200, { 'Cache-Control': 'no-store' });
  const probe = async (path, params) => {
    try {
      await get(path, params, 300);
      return 'ok';
    } catch (e) {
      return e instanceof UpstreamError && (e.status === 403 || e.status === 401) ? 'not entitled' : 'error';
    }
  };
  const [stocks, options, reference, earnings] = await Promise.all([
    probe('/v2/aggs/ticker/SPY/prev', { adjusted: 'true' }),
    probe('/v3/snapshot/options/SPY', { limit: 1 }),
    probe('/v3/reference/tickers/SPY', {}),
    probe('/benzinga/v1/earnings', { ticker: 'AAPL', limit: 1 }),
  ]);
  return json({ configured: true, provider: 'Massive.com', entitlements: { stocks, options, reference, earnings } }, 200, { 'Cache-Control': 'no-store' });
}
