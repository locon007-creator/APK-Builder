// Response helpers and best-effort per-IP rate limiting (per function instance).

const buckets = new Map();

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

export function error(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status, { 'Cache-Control': 'no-store' });
}

// Token bucket: `limit` requests per minute per client IP.
export function rateLimited(request, limit = 300) {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || 'local';
  const now = Date.now();
  const b = buckets.get(ip) || { tokens: limit, ts: now };
  b.tokens = Math.min(limit, b.tokens + ((now - b.ts) / 60000) * limit);
  b.ts = now;
  if (buckets.size > 5000) buckets.clear();
  buckets.set(ip, b);
  if (b.tokens < 1) return error('Too many requests — slow down and retry shortly', 429, { retryAfter: 5 });
  b.tokens -= 1;
  return null;
}

export const SYMBOL_RE = /^[A-Z]{1,5}(\.[A-Z])?$/;

export function numParam(url, name, def, min, max) {
  const raw = url.searchParams.get(name);
  if (raw == null || raw === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}
