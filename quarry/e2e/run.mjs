// Browser end-to-end checks for Quarry's main journeys.
// Usage: npm run build && npm run test:e2e
// Starts a demo-mode server and an empty SEC-mode server on temporary databases,
// then drives Chromium (playwright-core) at 360, 430 and 1280 CSS px widths.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = join(ROOT, 'e2e', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), 'quarry-e2e-'));
const exe = process.env.CHROMIUM_PATH ?? ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome'].find(existsSync);

function startServer(port, env) {
  const p = spawn(join(ROOT, 'node_modules/.bin/tsx'), ['server/index.ts'], {
    cwd: ROOT, env: { ...process.env, NODE_OPTIONS: '--no-warnings=ExperimentalWarning', PORT: String(port), MARKET_DATA_PROVIDER: 'none', ALERT_WEBHOOK_URL: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`server on ${port} did not start`)), 30000);
    p.stdout.on('data', (d) => { if (String(d).includes('listening')) { clearTimeout(t); resolve(p); } });
    p.stderr.on('data', (d) => process.stderr.write(d));
  });
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✓ ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

async function noOverflow(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert(sw <= cw + 1, `${label}: horizontal overflow ${sw} > ${cw}`);
}

const demo = await startServer(8790, { QUARRY_DATASET: 'demo', QUARRY_DB_PATH: join(tmp, 'demo.db') });
const sec = await startServer(8791, { QUARRY_DATASET: 'sec', QUARRY_DB_PATH: join(tmp, 'sec.db') });
const browser = await chromium.launch({ executablePath: exe });
const DEMO = 'http://localhost:8790';
const SEC = 'http://localhost:8791';

try {
  for (const width of [360, 430, 1280]) {
    console.log(`\nViewport ${width}px`);
    const mobile = width < 960;
    const ctx = await browser.newContext({ viewport: { width, height: mobile ? 800 : 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('dialog', (d) => d.accept());
    const shot = (n) => page.screenshot({ path: join(SHOTS, `${width}-${n}.png`) });

    await check('1. Home dashboard loads', async () => {
      await page.goto(DEMO + '/', { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: 'Today’s research' }).waitFor();
      await page.getByRole('heading', { name: 'Radar highlights' }).waitFor();
      await page.getByRole('heading', { name: 'Research shortcuts' }).waitFor();
      assert(await page.getByText('Demo dataset.').isVisible(), 'demo banner missing');
      await noOverflow(page, 'home');
      await shot('home');
    });

    await check('2. Search returns relevant results', async () => {
      await page.goto(DEMO + '/search');
      await page.getByLabel('Search stocks and investors').fill('ironb');
      await page.getByRole('link', { name: /IBBK · Ironbridge/ }).click();
      await page.getByRole('heading', { level: 1, name: /IBBK/ }).waitFor();
      await page.goto(DEMO + '/search');
      await page.getByLabel('Search stocks and investors').fill('lanternfish');
      await page.getByRole('link', { name: /Lanternfish Value Fund/ }).waitFor();
      await noOverflow(page, 'search');
    });

    await check('3. Investor profile opens and periods switch', async () => {
      await page.goto(DEMO + '/investors');
      await page.getByRole('link', { name: /Copperleaf Advisors/ }).click();
      await page.getByRole('heading', { level: 1, name: /Copperleaf/ }).waitFor();
      await page.getByText(/new holdings amendment accepted/i).waitFor();
      const sel = page.getByLabel('Reporting period');
      const opts = await sel.locator('option').allTextContents();
      assert(opts.length >= 3, 'expected several periods');
      await sel.selectOption({ index: 1 });
      await page.waitForURL(/period=/);
      await page.getByRole('tab', { name: 'History' }).click();
      await page.getByText('Share-count history', { exact: false }).waitFor();
      await noOverflow(page, 'investor');
      await shot('investor');
    });

    await check('4. Stock profile opens with correct insider classification', async () => {
      await page.goto(DEMO + '/stocks/HLMD');
      await page.getByRole('heading', { level: 1, name: /HLMD/ }).waitFor();
      await page.getByRole('heading', { name: 'Market context' }).waitFor();
      await shot('stock');
      await page.getByRole('tab', { name: 'Insiders' }).click();
      for (const label of ['Equity award', 'Tax withholding', 'Option exercise', 'Gift', 'Open-market purchase', 'Open-market sale']) {
        await page.locator('.badge', { hasText: label }).first().waitFor({ timeout: 4000 });
      }
      await page.getByRole('tab', { name: 'Timeline' }).click();
      await page.getByRole('heading', { name: 'Evidence timeline' }).waitFor();
      await noOverflow(page, 'stock');
    });

    await check('5. Radar mode, category and sheet filters work', async () => {
      await page.goto(DEMO + '/radar');
      await page.getByRole('group', { name: 'Research mode' }).getByRole('button', { name: 'Events' }).click();
      await page.getByRole('button', { name: /^Insider buying/ }).click();
      await page.waitForURL(/category=insider_buying/);
      const cats = await page.locator('article .badge.cat').allTextContents();
      assert(cats.length > 0 && cats.every((c) => c === 'Insider buying'), `unexpected categories ${cats}`);
      await page.getByRole('button', { name: /^Filters/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Filter Radar' });
      await dialog.getByLabel('Sector').selectOption('Financials');
      await dialog.getByRole('button', { name: 'Show results' }).click();
      await page.waitForURL(/sector=Financials/);
      await page.waitForFunction(() => [...document.querySelectorAll('article h3 a')].length > 0 && [...document.querySelectorAll('article h3 a')].every((a) => a.textContent === 'IBBK'));
      await noOverflow(page, 'radar filtered');
    });

    await check('6. Radar candidates show evidence and ranking', async () => {
      await page.goto(DEMO + '/radar');
      const card = page.locator('article.rcard').first();
      await card.getByRole('button', { name: 'Evidence & reasoning' }).click();
      for (const t of ['What changed?', 'Why might this matter?', 'What should be verified next?', 'How the priority was calculated']) await card.getByText(t).waitFor();
      await card.locator('.rank-table').waitFor();
      await card.getByText('Limitations').waitFor();
      await noOverflow(page, 'radar expanded');
      await shot('radar');
    });

    await check('7. Watchlist changes persist', async () => {
      await page.goto(DEMO + '/stocks/AURS');
      const btn = page.getByRole('button', { name: /^Follow AURS/ });
      await btn.click();
      await page.getByRole('button', { name: /^Following AURS/ }).waitFor();
      await page.reload();
      await page.getByRole('button', { name: /^Following AURS/ }).waitFor();
      await page.goto(DEMO + '/watchlist');
      await page.getByRole('link', { name: /AURS · Aurelia/ }).waitFor();
      await page.getByRole('button', { name: /Stop following AURS/ }).click();
      await page.getByText('Nothing followed yet').waitFor();
    });

    await check('8. Alert rules can be created, edited and removed', async () => {
      await page.goto(DEMO + '/watchlist?tab=rules');
      await page.getByRole('button', { name: 'New rule' }).click();
      const d = page.getByRole('dialog', { name: 'New alert rule' });
      await d.getByLabel('Alert when').selectOption('insider_purchase');
      await d.getByLabel('Name').fill('IBBK buys');
      await d.getByLabel('Applies to').selectOption('stock');
      await d.getByLabel('Stock', { exact: true }).selectOption({ label: 'IBBK · Ironbridge Bancorp (Demo)' });
      await d.getByRole('button', { name: 'Create rule' }).click();
      await page.getByText('IBBK buys', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Edit IBBK buys' }).click();
      const e = page.getByRole('dialog', { name: 'Edit alert rule' });
      await e.getByLabel('Name').fill('IBBK insider buys');
      await e.getByRole('button', { name: 'Save changes' }).click();
      await page.getByText('IBBK insider buys', { exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Alerts', exact: true }).click();
      await page.getByText(/Insider purchase: IBBK/).first().waitFor();
      await page.getByText(/In-app: delivered/).first().waitFor();
      await page.getByText(/webhook: not configured/).first().waitFor();
      await shot('alerts');
      await page.getByRole('tab', { name: 'Alert rules' }).click();
      await page.getByRole('button', { name: 'Delete IBBK insider buys' }).click();
      await page.getByText('No alert rules').waitFor();
    });

    await check('9. Comparisons work', async () => {
      await page.goto(DEMO + '/compare?type=investors');
      await page.getByLabel('Investor 1').selectOption({ index: 1 });
      await page.getByLabel('Investor 2').selectOption({ index: 2 });
      await page.getByRole('heading', { name: 'Holdings overlap' }).waitFor();
      await page.getByRole('heading', { name: 'Sector exposure' }).waitFor();
      await noOverflow(page, 'compare investors');
      await page.goto(DEMO + '/compare?type=stocks&ids=AURS,QSMI,IBBK');
      await page.getByText('Insider open-market buys').waitFor();
      await noOverflow(page, 'compare stocks');
      await shot('compare');
    });

    await check('10. Demo and unavailable states display correctly', async () => {
      await page.goto(DEMO + '/settings');
      await page.getByText('Demo (fictional)').waitFor();
      await page.goto(DEMO + '/stocks/IBBK');
      await page.getByText(/Simulated/).first().waitFor();
      // SEC mode with nothing ingested and no market provider:
      await page.goto(SEC + '/');
      await page.getByRole('heading', { name: 'Today’s research' }).waitFor();
      await page.getByText('No candidates yet').waitFor();
      assert(!(await page.getByText('Demo dataset.').count()), 'demo banner shown in SEC mode');
      await page.goto(SEC + '/radar?mode=event&category=unusual_market');
      await page.getByText('Requires a configured market-data provider.').first().waitFor();
      await page.goto(SEC + '/settings');
      await page.getByText(/No market-data provider configured/).waitFor();
      await shot('sec-unavailable');
      // Offline state (client-side navigation keeps cached data visible)
      await page.goto(DEMO + '/');
      await page.getByRole('heading', { name: 'Today’s research' }).waitFor();
      await ctx.setOffline(true);
      await page.evaluate(() => window.dispatchEvent(new Event('offline')));
      await page.getByText(/Offline\./).waitFor();
      await ctx.setOffline(false);
      await page.evaluate(() => window.dispatchEvent(new Event('online')));
    });

    await check(mobile ? '11. Mobile navigation works' : '12. Desktop layout remains usable', async () => {
      await page.goto(DEMO + '/');
      if (mobile) {
        const nav = page.locator('nav.bottomnav');
        assert(await nav.isVisible(), 'bottom nav hidden');
        assert(!(await page.locator('nav.sidenav').isVisible()), 'side nav visible on mobile');
        for (const [label, url] of [['Radar', /\/radar$/], ['Explore', /\/explore$/], ['Watchlist', /\/watchlist$/], ['Home', /\/$/]]) {
          await nav.getByRole('link', { name: label }).click();
          await page.waitForURL(url);
          await nav.locator(`a[aria-current="page"]`, { hasText: label }).waitFor({ timeout: 4000 });
        }
        await page.getByRole('link', { name: /More: investors/ }).click();
        await page.getByRole('link', { name: 'Settings & data' }).click();
        await page.getByRole('heading', { name: 'Settings & data' }).waitFor();
        const tap = await nav.getByRole('link', { name: 'Radar' }).boundingBox();
        assert(tap.height >= 44 && tap.width >= 44, 'tap target < 44px');
      } else {
        assert(await page.locator('nav.sidenav').isVisible(), 'side nav hidden on desktop');
        assert(!(await page.locator('nav.bottomnav').isVisible()), 'bottom nav visible on desktop');
        await page.locator('nav.sidenav').getByRole('link', { name: 'Investors' }).click();
        await page.getByRole('heading', { name: 'Investors', level: 1 }).waitFor();
        const main = await page.locator('main').boundingBox();
        assert(main.width > 700, 'main column too narrow on desktop');
      }
      await shot('nav');
    });

    await check('Accessibility basics: skip link, dark theme, keyboard tabs', async () => {
      await page.goto(DEMO + '/settings');
      await page.keyboard.press('Tab');
      assert(await page.evaluate(() => document.activeElement?.textContent) === 'Skip to content', 'skip link not first focus');
      await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'Dark' }).click();
      assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark theme not applied');
      await page.reload();
      assert(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'theme not persisted');
      await page.goto(DEMO + '/stocks/IBBK');
      await shot('stock-dark');
      await page.getByRole('tab', { name: 'Overview' }).focus();
      await page.keyboard.press('ArrowRight');
      await page.waitForURL(/tab=institutions/);
      await page.goto(DEMO + '/settings');
      await page.getByRole('group', { name: 'Theme' }).getByRole('button', { name: 'System' }).click();
    });

    await check('Historical view (as-of cutoff) changes the data used', async () => {
      await page.goto(DEMO + '/settings');
      await page.getByLabel('Cutoff date').fill('2026-08-01');
      await page.getByRole('button', { name: 'Apply' }).click();
      await page.getByText(/Historical view as of/).waitFor();
      await page.goto(DEMO + '/radar');
      await page.getByText(/Comparable 13F quarter: /).waitFor();
      const txt = await page.getByText(/Comparable 13F quarter: /).textContent();
      assert(/Mar 31, 2026/.test(txt), `expected Q1 period under cutoff, got: ${txt}`);
      await page.getByRole('button', { name: 'Return to now' }).click();
      await page.waitForFunction(() => !document.body.textContent.includes('Historical view as of'));
    });

    assert(errors.length === 0, `page errors: ${errors.join('; ')}`);
    await ctx.close();
  }
} finally {
  await browser.close();
  demo.kill();
  sec.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
