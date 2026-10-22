import { getRegime } from './_lib/analyze.js';
import { hasKey } from './_lib/massive.js';
import { json, error, rateLimited } from './_lib/http.js';

export async function GET(request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  if (!hasKey()) return error('Market data is not configured: set MASSIVE_API_KEY', 503, { code: 'NO_KEY' });
  try {
    return json(await getRegime(), 200, { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' });
  } catch (e) {
    return error(e.message, 502);
  }
}
