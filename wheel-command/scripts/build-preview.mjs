// Builds wheel-command-preview.html: one self-contained file (simulated data).
// Usage: npm run preview   (fetches esbuild via npx on first run)
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(mkdtempSync(join(tmpdir(), 'wheel-')), 'bundle.js');
execFileSync('npx', ['--yes', 'esbuild@0.24.0', join(root, 'preview/entry.js'), '--bundle', '--format=esm', '--platform=browser', '--target=es2022', '--minify', `--outfile=${out}`], { stdio: 'inherit' });

const read = (p) => readFileSync(join(root, p), 'utf8');
const js = readFileSync(out, 'utf8').replace(/<\/script/gi, '<\\/script');
const icon = Buffer.from(read('public/icon.svg')).toString('base64');
const html = read('public/index.html')
  .replace('<title>Wheel Command</title>', '<title>Wheel Command Preview</title>')
  .replace('<link rel="stylesheet" href="styles.css" />', () => `<style>${read('public/styles.css')}</style>`)
  .replace('<link rel="icon" href="icon.svg" type="image/svg+xml" />', `<link rel="icon" href="data:image/svg+xml;base64,${icon}" />`)
  .replace(/\s*<link rel="manifest"[^>]*>/, '')
  .replace('<script type="module" src="app.js"></script>', () => `<script type="module">${js}</script>`);
writeFileSync(join(root, 'wheel-command-preview.html'), html);
console.log(`wheel-command-preview.html — ${(html.length / 1024).toFixed(0)} KB`);
