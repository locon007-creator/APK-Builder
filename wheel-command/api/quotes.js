import { prevClose, hasKey } from './_lib/massive.js';
import { json, error, rateLimited, SYMBOL_RE } from './_lib/http.js';

// Latest daily close for held symbols (mark-to-market in My Wheel).
export async function GET(request) {
  const limited = rateLimited(request);
  if (limited) return limited;
  if (!hasKey()) return error('Market data is not configured: set MASSIVE_API_KEY', 503, { code: 'NO_KEY' });
  const symbols = [...new Set((new URL(request.url).searchParams.get('symbols') || '').toUpperCase().split(',').map((s) => s.trim()).filter(Boolean))];
  if (!symbols.length || symbols.length > 50 || !symbols.every((s) => SYMBOL_RE.test(s))) return error('Provide 1–50 valid symbols');
  const out = {};
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const r = await prevClose(s);
        out[s] = r ? { close: r.c, time: r.t } : null;
      } catch (e) {
        out[s] = null;
      }
    }),
  );
  return json({ quotes: out }, 200, { 'Cache-Control': 'public, s-maxage=120' });
}
