// Builds a single self-contained HTML preview of Quarry (no server needed):
//   1. exports a snapshot of the demo API from the real server code;
//   2. compiles the client with VITE_STATIC=1 (in-browser API stand-in, memory router);
//   3. inlines CSS, JS and the snapshot into dist-static/quarry-preview.html.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--no-warnings=ExperimentalWarning', ...env } });

run(join(root, 'node_modules/.bin/tsx'), ['server/cli/snapshot.ts']);
run(join(root, 'node_modules/.bin/vite'), ['build', '--outDir', 'dist-static/app', '--emptyOutDir'], { VITE_STATIC: '1' });

const assets = join(root, 'dist-static/app/assets');
const files = readdirSync(assets);
const js = files.filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8'));
const css = files.filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(assets, f), 'utf8'));
if (js.length !== 1) throw new Error(`expected one JS bundle, found ${js.length}`);
const snapshot = readFileSync(join(root, 'dist-static/snapshot.json'), 'utf8');
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1');

// The artifact host supplies the document skeleton (doctype, head, body).
const html = `<title>Quarry Research</title>
<meta name="description" content="Quarry — evidence-first research on institutional positioning, insider activity and corporate events. Browser preview with fictional demo data.">
<style>${css.join('\n')}</style>
<script>try { var t = localStorage.getItem('quarry.theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch (e) {}</script>
<div id="root"></div>
<script type="application/json" id="quarry-snapshot">${safe(snapshot)}</script>
<script type="module">${safe(js[0])}</script>
`;
writeFileSync(join(root, 'dist-static/quarry-preview.html'), html);
console.log(`dist-static/quarry-preview.html — ${(html.length / 1e6).toFixed(2)} MB`);
