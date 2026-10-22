// Local development server: serves /public and routes /api/<name> to the
// same Web-standard handlers Vercel runs. Reads MASSIVE_API_KEY from env/.env.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
if (existsSync(join(root, '.env'))) {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
if (process.env.WHEEL_MOCK_UPSTREAM) await import(process.env.WHEEL_MOCK_UPSTREAM);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.env.PORT) || 3000;

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    try {
      const api = url.pathname.match(/^\/api\/([a-z]+)$/);
      if (api) {
        const file = join(root, 'api', `${api[1]}.js`);
        if (!existsSync(file)) return res.writeHead(404).end('Not found');
        const mod = await import(file);
        const handler = mod[req.method];
        if (!handler) return res.writeHead(405).end('Method not allowed');
        const response = await handler(new Request(url, { method: req.method, headers: req.headers }));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        return res.end(Buffer.from(await response.arrayBuffer()));
      }
      const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
      const path = join(root, 'public', rel);
      if (!path.startsWith(join(root, 'public'))) return res.writeHead(403).end();
      const body = await readFile(path).catch(() => null);
      if (!body) return res.writeHead(404).end('Not found');
      res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(body);
    } catch (e) {
      console.error(e);
      res.writeHead(500).end('Server error');
    }
  })
  .listen(port, () => console.log(`Wheel Command → http://localhost:${port}`));
