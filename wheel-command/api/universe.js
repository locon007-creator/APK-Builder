import { UNIVERSES } from './_lib/universes.js';
import { json, error } from './_lib/http.js';

export async function GET(request) {
  const market = new URL(request.url).searchParams.get('market');
  if (!market) {
    const list = Object.entries(UNIVERSES).map(([key, u]) => ({ key, label: u.label, count: u.symbols.length, asOf: u.asOf, note: u.note ?? null }));
    return json({ markets: list }, 200, { 'Cache-Control': 'public, s-maxage=86400' });
  }
  const u = UNIVERSES[market];
  if (!u) return error('Unknown market', 404);
  return json({ key: market, ...u }, 200, { 'Cache-Control': 'public, s-maxage=86400' });
}
