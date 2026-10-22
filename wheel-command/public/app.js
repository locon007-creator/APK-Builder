import * as S from './store.js';

// ---------- formatting ----------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const money = (x, dec = 0) => (isNum(x) ? (x < 0 ? '−$' : '$') + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : '—');
const smoney = (x, dec = 0) => (isNum(x) ? (x > 0 ? '+' : '') + money(x, dec) : '—');
const px = (x) => money(x, 2);
const pct = (x, d = 1) => (isNum(x) ? `${(x * 100).toFixed(d)}%` : '—');
const spct = (x, d = 1) => (isNum(x) ? `${x > 0 ? '+' : ''}${(x * 100).toFixed(d)}%` : '—');
const n0 = (x) => (isNum(x) ? Math.round(x).toLocaleString('en-US') : '—');
const compact = (x) => (isNum(x) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(x) : '—');
const cls = (x) => (isNum(x) ? (x > 0 ? 'pos' : x < 0 ? 'neg' : '') : '');
const fdate = (iso, withYear) => {
  if (!iso) return '—';
  const d = new Date(iso + 'T12:00:00');
  const y = withYear ?? d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(y ? { year: '2-digit' } : {}) });
};
const daysTo = (iso) => Math.round((new Date(iso + 'T12:00:00') - new Date(S.today() + 'T12:00:00')) / 86400000);
const scoreColor = (s) => (s >= 75 ? 'var(--green)' : s >= 62 ? 'var(--blue)' : s >= 48 ? 'var(--amber)' : 'var(--red)');
const verdictClass = (v) => ({ 'Strong Candidate': 'strong', Favorable: 'favorable', Watch: 'watch', Avoid: 'avoid' })[v] || 'unverified';
const STRAT = { csp: 'Cash-Secured Put', cc: 'Covered Call', both: 'Both' };
const STRAT_SHORT = { csp: 'CSP', cc: 'CC' };

// ---------- icons ----------
const ICON = {
  scanner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/><path d="M8 11h6M11 8v6" opacity=".6"/></svg>',
  opportunities: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>',
  wheel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/><path d="M12 3.5v6.3M12 14.2v6.3M3.5 12h6.3M14.2 12h6.3"/></svg>',
  income: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
};
const ROUTES = [
  ['scanner', 'Scanner'],
  ['opportunities', 'Opportunities'],
  ['wheel', 'My Wheel'],
  ['income', 'Income'],
  ['settings', 'Settings'],
];

// ---------- API ----------
async function api(path, opts = {}) {
  let res;
  try {
    res = await fetch(path, { signal: opts.signal, headers: { Accept: 'application/json' } });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw Object.assign(new Error('Network error — check your connection'), { status: 0 });
  }
  let body = null;
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) throw Object.assign(new Error(body?.error || `Request failed (${res.status})`), { status: res.status, code: body?.code });
  return body;
}

// ---------- app state (session-only UI state) ----------
const ui = {
  open: new Set(),
  tier: {},
  strat: {},
  filter: 'all',
  scan: null, // live scan progress
  health: null,
  regime: null,
  regimeErr: null,
  markets: null,
  quotes: {},
};

// ---------- small components ----------
function spark(values, { w = 160, h = 42, color } = {}) {
  const v = (values || []).filter(isNum);
  if (v.length < 2) return '';
  const min = Math.min(...v);
  const max = Math.max(...v);
  const span = max - min || 1;
  const pts = v.map((y, i) => `${((i / (v.length - 1)) * w).toFixed(1)},${(h - 3 - ((y - min) / span) * (h - 6)).toFixed(1)}`);
  const c = color || (v[v.length - 1] >= v[0] ? 'var(--green)' : 'var(--red)');
  const id = 'g' + Math.random().toString(36).slice(2, 8);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}" stop-opacity=".28"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></linearGradient></defs><path d="M0,${h} L${pts.join(' L')} L${w},${h} Z" fill="url(#${id})"/><polyline points="${pts.join(' ')}" fill="none" stroke="${c}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
}

function ring(score) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const v = isNum(score) ? score : 0;
  return `<div class="ring" role="img" aria-label="Opportunity score ${isNum(score) ? score : 'unavailable'} of 100"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="4.5"/><circle cx="26" cy="26" r="${r}" fill="none" stroke="${scoreColor(v)}" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="${((v / 100) * c).toFixed(1)} ${c.toFixed(1)}"/></svg><span>${isNum(score) ? score : '—'}</span></div>`;
}

const seg = (name, options, value, attrs = '') => {
  const extra = (attrs.match(/class="([^"]*)"/) || [])[1] || '';
  return `<div class="seg ${extra.replace(/\bseg\b/, '').trim()}" role="radiogroup" ${attrs.replace(/class="[^"]*"/, '')}>${options.map(([v, l, dis]) => `<button type="button" role="radio" aria-checked="${v === value}" class="${v === value ? 'on' : ''}" data-seg="${name}" data-value="${esc(v)}" ${dis ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
};

const metric = (k, v, c = '') => `<div class="metric"><div class="k">${k}</div><div class="v num ${c}">${v}</div></div>`;
const kpi = (label, value, sub = '', c = '') => `<div class="kpi-tile"><div class="label">${label}</div><div class="value num ${c}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;

function toast(msg, err = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.innerHTML = `<span class="dot ${err ? 'bad' : 'ok'}"></span><span>${esc(msg)}</span>`;
  $('#toasts').append(el);
  setTimeout(() => el.remove(), 3800);
}

// ---------- sheet / forms ----------
let sheetCleanup = null;
function closeSheet() {
  $('#sheet-root').innerHTML = '';
  sheetCleanup?.();
  sheetCleanup = null;
}
function openSheet(html, onMount) {
  closeSheet();
  const root = $('#sheet-root');
  root.innerHTML = `<div class="scrim" data-close></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  const sheet = $('.sheet', root);
  root.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheet));
  const onKey = (e) => e.key === 'Escape' && closeSheet();
  document.addEventListener('keydown', onKey);
  sheetCleanup = () => document.removeEventListener('keydown', onKey);
  onMount?.(sheet);
  sheet.querySelector('input:not([type=hidden]), select, button')?.focus();
  return sheet;
}

function field(f) {
  const id = 'f_' + f.name;
  if (f.type === 'select')
    return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${f.label}</label><select class="input" id="${id}" name="${f.name}">${f.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(f.value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${f.label}${f.hint ? `<span class="dim">${f.hint}</span>` : ''}</label><div class="input-wrap">${f.prefix ? `<span class="prefix">${f.prefix}</span>` : ''}<input class="input num" id="${id}" name="${f.name}" type="${f.type || 'number'}" value="${esc(f.value ?? '')}" ${f.step ? `step="${f.step}"` : f.type ? '' : 'step="any"'} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${f.readonly ? 'readonly' : ''} ${f.type === 'text' ? 'autocapitalize="characters" autocomplete="off"' : 'inputmode="decimal"'} required>${f.suffix ? `<span class="suffix">${f.suffix}</span>` : ''}</div></div>`;
}

function openForm({ title, sub, fields, submit = 'Save', danger, onSubmit, preview }) {
  openSheet(
    `<form novalidate><h3>${title}</h3>${sub ? `<div class="sub">${sub}</div>` : ''}<div class="form-grid">${fields.map(field).join('')}</div><div class="preview"></div><div class="banner err hidden" role="alert"></div><div class="foot"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${submit}</button></div></form>`,
    (sheet) => {
      const form = $('form', sheet);
      $('[data-close]', form).addEventListener('click', closeSheet);
      const values = () => Object.fromEntries(new FormData(form).entries());
      const upd = () => preview && ($('.preview', form).innerHTML = preview(values()) || '');
      form.addEventListener('input', upd);
      upd();
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        try {
          onSubmit(values());
          closeSheet();
        } catch (err) {
          const b = $('.banner', form);
          b.textContent = err.message;
          b.classList.remove('hidden');
        }
      });
    },
  );
}

function confirmSheet(title, body, label, fn, danger = true) {
  openSheet(`<h3>${title}</h3><div class="sub">${body}</div><div class="foot"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf">${label}</button></div>`, (sh) => {
    $('#cf', sh).addEventListener('click', () => {
      fn();
      closeSheet();
    });
  });
}

// ---------- router ----------
const route = () => (location.hash.replace(/^#\/?/, '').split('?')[0] || 'scanner');

function renderChrome() {
  const r = route();
  const links = ROUTES.map(([k, l]) => `<a href="#/${k}" class="${r === k ? 'active' : ''}" ${r === k ? 'aria-current="page"' : ''}>${l}</a>`).join('');
  $('#nav').innerHTML = links;
  $('#tabbar').innerHTML = ROUTES.map(([k, l]) => `<a href="#/${k}" class="${r === k ? 'active' : ''}" ${r === k ? 'aria-current="page"' : ''}>${ICON[k]}<span>${l === 'Opportunities' ? 'Ideas' : l}</span></a>`).join('');
  const h = ui.health;
  const st = !h ? ['', 'Checking data…'] : h.error ? ['bad', 'Data offline'] : !h.configured ? ['warn', 'No data key'] : h.entitlements?.options === 'ok' ? ['ok', 'Live data'] : ['warn', 'Limited data'];
  $('#status').innerHTML = `<a href="#/settings" class="row muted" style="gap:7px"><span class="dot ${st[0]}"></span><span>${st[1]}</span></a>`;
}

function render() {
  renderChrome();
  const r = route();
  const view = $('#view');
  const views = { scanner: viewScanner, opportunities: viewOpportunities, wheel: viewWheel, income: viewIncome, settings: viewSettings };
  view.innerHTML = (views[r] || viewScanner)();
  afterRender[r]?.();
}
const afterRender = {};

window.addEventListener('hashchange', () => {
  render();
  window.scrollTo({ top: 0 });
});
S.subscribe(() => {
  // Re-render on data changes except while scanning (progress renders itself).
  if (!ui.scan?.running || route() !== 'scanner') render();
});

// ---------- SCANNER ----------
function viewScanner() {
  const s = S.getState().settings;
  const markets = ui.markets || [
    { key: 'sp100', label: 'S&P 100' },
    { key: 'ndx100', label: 'NASDAQ 100' },
    { key: 'nyse100', label: 'NYSE 100' },
    { key: 'dow30', label: 'Dow Jones 30' },
  ];
  const scan = ui.scan;
  const g = ui.regime;
  const keyMissing = ui.health && !ui.health.error && !ui.health.configured;
  return `
  <div class="eyebrow">Step 1 · Select</div>
  <h1 class="title">Find income.</h1>
  <p class="lede">Pick a market and strategy. One scan ranks the best risk-adjusted Wheel trades.</p>
  ${keyMissing ? `<div class="banner"><div><b>Market data not connected.</b> Add <span class="mono">MASSIVE_API_KEY</span> to the Vercel project's environment variables, then redeploy. Scans need real quotes — nothing is simulated.</div></div>` : ''}
  <div class="card regime" style="margin-bottom:18px">
    ${g ? `<div><div class="eyebrow">Market · SPY</div><div class="row" style="gap:10px;margin-top:4px"><span class="big num">${px(g.spy?.close)}</span><span class="num ${cls(g.spy?.change1d)}">${spct(g.spy?.change1d, 2)}</span></div></div><div class="spark">${spark(g.spy?.spark, { w: 300, h: 42 })}</div><div style="text-align:right"><span class="pill ${g.label === 'Risk-on' ? 'strong' : g.label === 'Risk-off' ? 'avoid' : 'watch'}">${esc(g.label)}</span><div class="note" style="margin-top:6px;max-width:190px">${esc(g.detail)}</div></div>` : ui.regimeErr ? `<div class="muted" style="font-size:13.5px">Market regime unavailable — ${esc(ui.regimeErr)}</div>` : `<div class="skeleton" style="height:42px;flex:1"></div>`}
  </div>

  <h2 class="section">Market</h2>
  <div class="tiles">${markets.map((m) => `<button class="tile ${s.market === m.key ? 'on' : ''}" data-market="${m.key}" aria-pressed="${s.market === m.key}"><div class="t-name">${esc(m.label)}</div><div class="t-sub">${m.count ? `${m.count} stocks` : '&nbsp;'}</div></button>`).join('')}</div>

  <h2 class="section">Strategy</h2>
  ${seg('strategy', [['csp', 'Cash-Secured Puts'], ['cc', 'Covered Calls'], ['both', 'Both']], s.strategy)}

  <h2 class="section">Filters</h2>
  <div class="card"><div class="form-grid">
    <div class="field"><label for="capital">Available capital</label><div class="input-wrap"><span class="prefix">$</span><input class="input num" id="capital" data-setting="capital" type="number" min="100" step="500" inputmode="decimal" value="${s.capital}"></div></div>
    <div class="field"><div class="label"><span>Expiration window</span><span class="dim num">${s.dteMin}–${s.dteMax} days</span></div>
      <div class="row"><div class="input-wrap" style="flex:1"><input class="input num" data-setting="dteMin" type="number" min="1" max="120" value="${s.dteMin}" aria-label="Minimum days to expiration"><span class="suffix">d</span></div><span class="dim">to</span><div class="input-wrap" style="flex:1"><input class="input num" data-setting="dteMax" type="number" min="1" max="180" value="${s.dteMax}" aria-label="Maximum days to expiration"><span class="suffix">d</span></div></div>
      <div class="chips">${[[15, 30], [15, 45], [21, 45], [30, 60]].map(([a, b]) => `<button class="chip ${s.dteMin === a && s.dteMax === b ? 'on' : ''}" data-dte="${a},${b}">${a}–${b}d</button>`).join('')}</div></div>
    <div class="field"><div class="label"><span>Income target</span><span class="num" data-live style="color:var(--text)">${s.target.toFixed(2)}% / month <span class="dim">≈ ${(s.target * 12).toFixed(0)}% / yr</span></span></div><input class="range" type="range" min="0.5" max="4" step="0.25" value="${s.target}" data-setting="target" aria-label="Monthly income target"></div>
    <div class="field"><div class="label">Risk tolerance</div>${seg('risk', [['conservative', 'Conservative'], ['balanced', 'Balanced'], ['aggressive', 'Aggressive']], s.risk, 'class="seg small"')}</div>
  </div>
  <details class="adv" style="margin-top:12px"><summary>Advanced filters</summary><div class="body form-grid">
    <div class="field"><label>Min open interest</label><input class="input num" type="number" min="0" step="50" data-setting="minOI" value="${s.minOI}"></div>
    <div class="field"><label>Max bid/ask spread</label><div class="input-wrap"><input class="input num" type="number" min="1" max="100" step="1" data-setting="maxSpread" value="${s.maxSpread}"><span class="suffix">%</span></div></div>
    <div class="field"><label>Results to show</label><input class="input num" type="number" min="10" max="20" step="1" data-setting="results" value="${s.results}"></div>
    <div class="field"><label>Risk-free rate <span class="dim">probability model</span></label><div class="input-wrap"><input class="input num" type="number" min="0" max="20" step="0.25" data-setting="rate" value="${s.rate}"><span class="suffix">%</span></div></div>
  </div></details>
  </div>

  <div style="margin-top:22px" id="scan-zone">${scanZone(scan)}</div>
  <p class="note" style="margin-top:16px">Analytics only — not investment advice. Options involve risk of substantial loss; verify quotes with your broker before trading.</p>`;
}

function scanZone(scan) {
  if (!scan?.running) {
    const last = S.getState().lastScan;
    return `<button class="btn primary scan-btn" id="scan-go">${ICON.scanner.replace('<svg', '<svg style="width:20px;height:20px"')} Scan ${esc(marketLabel(S.getState().settings.market))}</button>${last ? `<div class="row between" style="margin-top:12px;font-size:13px"><span class="muted">Last scan · ${esc(last.marketLabel)} · ${new Date(last.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><a href="#/opportunities">View results →</a></div>` : ''}`;
  }
  const p = scan.total ? scan.done / scan.total : 0;
  return `<div class="card scan-live"><div class="row between"><div><div class="eyebrow">Scanning ${esc(scan.marketLabel)}</div><div class="big num" style="margin-top:4px">${scan.done}<span class="dim" style="font-size:.6em"> / ${scan.total}</span></div></div><button class="btn sm" id="scan-stop">Cancel</button></div>
    <div class="progress"><i style="width:${(p * 100).toFixed(1)}%"></i></div>
    <div class="row between note"><span>${scan.found} qualified · ${scan.unverified} unverified${scan.errors ? ` · ${scan.errors} errors` : ''}</span><span>${scan.current.length ? 'Analyzing ' + scan.current.map(esc).join(', ') : ''}</span></div>
    <div class="ticker-flow">${scan.flow.slice(-60).map(([sym, ok]) => `<span class="${ok ? 'ok' : 'bad'}">${esc(sym)}</span>`).join('')}</div></div>`;
}

const marketLabel = (k) => (ui.markets || []).find((m) => m.key === k)?.label || { sp100: 'S&P 100', ndx100: 'NASDAQ 100', nyse100: 'NYSE 100', dow30: 'Dow Jones 30' }[k] || k;

afterRender.scanner = () => {
  const v = $('#view');
  v.querySelectorAll('[data-market]').forEach((b) => b.addEventListener('click', () => S.updateSettings({ market: b.dataset.market })));
  v.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => S.updateSettings({ [b.dataset.seg]: b.dataset.value })));
  v.querySelectorAll('[data-dte]').forEach((b) => b.addEventListener('click', () => {
    const [a, c] = b.dataset.dte.split(',').map(Number);
    S.updateSettings({ dteMin: a, dteMax: c });
  }));
  bindSettingInputs(v);
  bindScanZone();
};

function bindSettingInputs(root) {
  const LIM = { capital: [100, 1e9], dteMin: [1, 120], dteMax: [1, 180], target: [0.5, 4], minOI: [0, 1e6], maxSpread: [1, 100], results: [10, 20], rate: [0, 20], fee: [0, 50] };
  root.querySelectorAll('[data-setting]').forEach((inp) => {
    const apply = () => {
      const k = inp.dataset.setting;
      let val = Number(inp.value);
      if (!Number.isFinite(val)) return;
      const [lo, hi] = LIM[k];
      val = Math.min(hi, Math.max(lo, val));
      const patch = { [k]: k === 'results' || k === 'dteMin' || k === 'dteMax' ? Math.round(val) : val };
      const cur = S.getState().settings;
      if (k === 'dteMin' && patch.dteMin > cur.dteMax) patch.dteMax = patch.dteMin;
      if (k === 'dteMax' && patch.dteMax < cur.dteMin) patch.dteMin = patch.dteMax;
      S.updateSettings(patch);
    };
    inp.addEventListener('change', apply);
    if (inp.type === 'range') {
      // Live label while dragging; commit (and re-render) on release.
      inp.addEventListener('input', () => {
        const out = inp.closest('.field')?.querySelector('[data-live]');
        if (out) out.innerHTML = `${Number(inp.value).toFixed(2)}% / month <span class="dim">≈ ${(inp.value * 12).toFixed(0)}% / yr</span>`;
      });
    }
  });
}

function bindScanZone() {
  $('#scan-go')?.addEventListener('click', runScan);
  $('#scan-stop')?.addEventListener('click', () => ui.scan?.controller.abort());
}
const refreshScanZone = () => {
  const z = $('#scan-zone');
  if (z && route() === 'scanner') {
    z.innerHTML = scanZone(ui.scan);
    bindScanZone();
  }
};

function analyzeQuery(symbol, s, extra = {}) {
  const q = new URLSearchParams({ symbol, strategy: s.strategy, risk: s.risk, dteMin: s.dteMin, dteMax: s.dteMax, capital: s.capital, target: s.target, rate: s.rate, minOI: s.minOI, maxSpread: s.maxSpread, ...extra });
  return `/api/analyze?${q}`;
}

async function runScan() {
  if (ui.scan?.running) return;
  const s = { ...S.getState().settings };
  const controller = new AbortController();
  let universe;
  try {
    universe = await api(`/api/universe?market=${encodeURIComponent(s.market)}`);
  } catch (e) {
    return toast(e.message, true);
  }
  const scan = (ui.scan = { running: true, controller, marketLabel: universe.label, total: universe.symbols.length, done: 0, found: 0, unverified: 0, errors: 0, current: [], flow: [], results: [] });
  refreshScanZone();
  const queue = [...universe.symbols];
  let fatal = null;
  const worker = async () => {
    while (queue.length && !controller.signal.aborted && !fatal) {
      const sym = queue.shift();
      scan.current.push(sym);
      refreshScanZone();
      let r;
      for (let attempt = 0; ; attempt++) {
        try {
          r = await api(analyzeQuery(sym, s), { signal: controller.signal });
          break;
        } catch (e) {
          if (e.name === 'AbortError') return;
          if (e.code === 'NO_KEY') {
            fatal = e;
            return;
          }
          if (e.status === 429 && attempt < 3) {
            await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
            continue;
          }
          r = { symbol: sym, status: 'error', error: e.message, verdict: 'Unverified' };
          break;
        }
      }
      scan.current = scan.current.filter((x) => x !== sym);
      scan.results.push(r);
      scan.done++;
      if (r.status === 'ok') scan.found++;
      else if (r.status === 'error') scan.errors++;
      else if (r.status === 'unverified') scan.unverified++;
      scan.flow.push([sym, r.status === 'ok']);
      refreshScanZone();
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  scan.running = false;
  if (fatal) {
    ui.scan = null;
    refreshScanZone();
    return toast(fatal.message, true);
  }
  if (!scan.results.length) {
    ui.scan = null;
    return refreshScanZone();
  }
  const partial = controller.signal.aborted;
  S.saveScan({ id: Date.now(), at: Date.now(), market: s.market, marketLabel: universe.label, params: s, total: universe.symbols.length, partial, results: scan.results });
  ui.scan = null;
  ui.open = new Set();
  ui.filter = 'all';
  toast(partial ? `Scan stopped — ${scan.done} of ${scan.total} analyzed` : `Scan complete — ${scan.found} opportunities found`);
  location.hash = '#/opportunities';
  render();
}

// ---------- OPPORTUNITIES ----------
function partitionScan(scan) {
  const ok = scan.results.filter((r) => r.status === 'ok').sort((a, b) => b.score - a.score);
  return {
    ranked: ok.slice(0, scan.params.results),
    more: ok.length - Math.min(ok.length, scan.params.results),
    unverified: scan.results.filter((r) => r.status === 'unverified'),
    filtered: scan.results.filter((r) => r.status === 'no-contracts'),
    errors: scan.results.filter((r) => r.status === 'error'),
  };
}

function viewOpportunities() {
  const scan = S.getState().lastScan;
  if (!scan) return `<div class="empty"><div class="icon">${ICON.opportunities}</div><h3>No scan yet</h3><p>Run a scan to see ranked opportunities.</p><a class="btn primary" href="#/scanner">Go to Scanner</a></div>`;
  const p = partitionScan(scan);
  const counts = { all: p.ranked.length };
  for (const r of p.ranked) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
  const shown = ui.filter === 'all' ? p.ranked : p.ranked.filter((r) => r.verdict === ui.filter);
  const sp = scan.params;
  return `
  <div class="eyebrow">Step 2 · Review</div>
  <h1 class="title">Top opportunities</h1>
  <p class="lede">${esc(scan.marketLabel)} · ${STRAT[sp.strategy]} · ${sp.dteMin}–${sp.dteMax}d · ${esc(sp.risk[0].toUpperCase() + sp.risk.slice(1))} · ${money(sp.capital)} capital${scan.partial ? ' · <span class="warn">partial scan</span>' : ''}</p>
  <div class="grid kpi" style="margin-bottom:18px">
    ${kpi('Scanned', n0(scan.results.length), `of ${scan.total}`)}
    ${kpi('Qualified', n0(p.ranked.length + p.more), p.more ? `top ${p.ranked.length} shown` : 'ranked below', 'pos')}
    ${kpi('Unverified', n0(p.unverified.length + p.errors.length), 'missing data')}
    ${kpi('Filtered out', n0(p.filtered.length), 'no liquid strike fits')}
  </div>
  <div class="row between wrap" style="margin-bottom:14px;gap:12px">
    <div class="chips">${['all', 'Strong Candidate', 'Favorable', 'Watch', 'Avoid'].map((f) => `<button class="chip ${ui.filter === f ? 'on' : ''}" data-filter="${f}">${f === 'all' ? 'All' : f} <span class="dim">${counts[f] || 0}</span></button>`).join('')}</div>
    <div class="row"><span class="note">${new Date(scan.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><button class="btn sm" id="rescan">Rescan</button></div>
  </div>
  ${shown.length ? shown.map((r) => oppCard(r, p.ranked.indexOf(r) + 1, sp)).join('') : `<div class="card empty" style="padding:30px"><h3>Nothing here</h3><p>No ${ui.filter === 'all' ? '' : esc(ui.filter) + ' '}opportunities passed your filters. Try a wider expiration window, lower minimum open interest, or more capital.</p></div>`}
  ${listSection('Unverified', [...p.unverified, ...p.errors], 'Essential market data was unavailable, so no score or probability is shown.')}
  ${listSection('Filtered out', p.filtered, 'Analyzed with real data, but no contract met liquidity, delta, expiration or capital filters.')}
  <p class="note" style="margin-top:20px">Opportunity Score (0–100) = Trend 20% · Quality 15% · Liquidity 20% · Income 20% · Risk 25%, plus a market-regime adjustment. Probabilities are risk-neutral estimates from each contract's implied volatility (Black-Scholes), not predictions. Premiums at bid/ask midpoint.</p>`;
}

function listSection(title, items, note) {
  if (!items.length) return '';
  return `<details class="adv" style="margin-top:14px"><summary>${title} · ${items.length}</summary><div class="body"><p class="note" style="margin-top:0">${note}</p><div class="mini-list">${items
    .map((r) => {
      const reasons = [r.error, ...(r.reasons || []), ...Object.values(r.strategies || {}).flatMap((x) => x.reasons || [])].filter(Boolean);
      return `<div><span class="s">${esc(r.symbol)}</span><span class="muted" style="flex:1;font-size:12.5px">${esc([...new Set(reasons)].join(' · ') || 'Unavailable')}</span>${r.status === 'error' ? `<button class="btn sm" data-retry="${esc(r.symbol)}">Retry</button>` : ''}</div>`;
    })
    .join('')}</div></div></details>`;
}

function stratKeyFor(r) {
  const avail = Object.entries(r.strategies || {}).filter(([, v]) => v.status === 'ok').map(([k]) => k);
  const want = ui.strat[r.symbol];
  return avail.includes(want) ? want : r.primary;
}
function tierKeyFor(r, st) {
  const want = ui.tier[r.symbol];
  return want && st.tiers[want] ? want : st.selected;
}

function oppCard(r, rank, params, { hideRank } = {}) {
  const sk = stratKeyFor(r);
  const st = r.strategies[sk];
  const tk = tierKeyFor(r, st);
  const c = st.tiers[tk];
  const m = r.stock.metrics;
  const open = ui.open.has(r.symbol);
  const isPut = sk === 'csp';
  return `<article class="opp ${open ? 'open' : ''}" data-sym="${esc(r.symbol)}">
    <button class="opp-head" data-toggle="${esc(r.symbol)}" aria-expanded="${open}">
      <span class="rank">${hideRank ? '' : rank}</span>
      <div style="min-width:0">
        <div class="sym">${esc(r.symbol)} <span class="px num">${px(r.price)}</span> <span class="chg num ${cls(m.change1d)}">${spct(m.change1d, 2)}</span></div>
        <div class="opp-name">${esc(r.name || r.sector || '')}</div>
        <div class="opp-line"><span class="pill tag">${STRAT_SHORT[sk]}</span><span><b class="num">$${c.strike}</b> ${isPut ? 'put' : 'call'} · ${fdate(c.expiration)}</span><span class="num"><b>${px(c.premium)}</b> · <b class="pos">${pct(c.monthly, 2)}</b>/mo</span><span class="num">Δ ${Math.abs(c.delta).toFixed(2)}</span></div>
      </div>
      <div class="score-wrap">${ring(st.score)}<span class="pill ${verdictClass(st.verdict)}">${esc(st.verdict)}</span></div>
    </button>
    ${open ? oppBody(r, sk, st, tk, c, params) : ''}
  </article>`;
}

function oppBody(r, sk, st, tk, c, params) {
  const m = r.stock.metrics;
  const isPut = sk === 'csp';
  const others = Object.entries(r.strategies).filter(([, v]) => v.status === 'ok');
  const affordable = isPut ? Math.floor(params.capital / c.collateral) : c.collateral ? Math.floor(params.capital / c.collateral) : null;
  const n = Math.max(1, affordable || 1);
  const b = st.breakdown;
  const bar = (label, w, v) => `<div class="bar-row"><span class="lbl">${label} <small>${Math.round(w * 100)}%</small></span><div class="bar"><i style="width:${v ?? 0}%;background:${v == null ? 'var(--surface-3)' : scoreColor(v)}"></i></div><span class="val num">${v ?? '—'}</span></div>`;
  const pRisk = c.pAssign;
  const range = m.high52 > m.low52 ? ((r.price - m.low52) / (m.high52 - m.low52)) * 100 : null;
  const earn = r.stock.earningsDate;
  const div = r.stock.dividend;
  const nonSel = Object.values(r.strategies).filter((x) => x.status !== 'ok');
  return `<div class="opp-body">
    ${others.length > 1 ? seg('strat:' + r.symbol, others.map(([k]) => [k, STRAT[k]]), sk, 'class="seg small"') : ''}
    ${seg('tier:' + r.symbol, [['conservative', 'Conservative'], ['balanced', 'Balanced'], ['aggressive', 'Aggressive']].map(([k, l]) => [k, st.tiers[k] ? `${l} <span class="dim num">Δ${Math.abs(st.tiers[k].delta).toFixed(2)}</span>` : `${l} <span class="dim">—</span>`, !st.tiers[k]]), tk, 'class="seg small"')}
    <div class="contract-hero">
      <div><div class="what">Sell <b>${esc(r.symbol)} ${fdate(c.expiration, true)} $${c.strike} ${isPut ? 'Put' : 'Call'}</b> · ${c.dte} days</div>
        <div class="row" style="gap:12px;margin-top:6px;align-items:baseline"><span class="huge num">${money(c.premiumTotal)}</span><span class="muted">per contract</span></div></div>
      <div style="text-align:right"><div class="big num pos">${pct(c.monthly, 2)}<span class="dim" style="font-size:.5em"> /mo</span></div><div class="muted num" style="font-size:13px">${pct(c.annualized, 1)} annualized</div></div>
    </div>
    <div class="metrics">
      ${metric('Strike', px(c.strike))}
      ${metric('Expiration', `${fdate(c.expiration)} · ${c.dte}d`)}
      ${metric('Premium (mid)', px(c.premium))}
      ${metric('Bid / Ask', `${px(c.bid)} / ${px(c.ask)}`)}
      ${metric('Spread', pct(c.spreadPct, 1), c.spreadPct <= 0.06 ? 'pos' : c.spreadPct > 0.1 ? 'neg' : 'warn')}
      ${metric('Delta', c.delta.toFixed(3))}
      ${metric('Implied vol', pct(c.iv, 1))}
      ${metric('IV / HV20', isNum(c.ivhv) ? c.ivhv.toFixed(2) + '×' : '—')}
      ${metric('Open interest', n0(c.oi))}
      ${metric('Volume', n0(c.volume))}
      ${metric('Break-even', px(c.breakeven))}
      ${metric(isPut ? 'Collateral' : params.basis ? 'Shares owned' : 'Share cost', c.collateral ? money(c.collateral) : '—')}
      ${metric('Prob. OTM', pct(c.pOTM, 0), c.pOTM >= 0.7 ? 'pos' : c.pOTM < 0.55 ? 'neg' : 'warn')}
      ${metric('Prob. profit', pct(c.pProfit, 0), c.pProfit >= 0.75 ? 'pos' : c.pProfit < 0.6 ? 'neg' : 'warn')}
      ${metric('Expected move', isNum(c.expectedMove) ? '±' + px(c.expectedMove) : '—')}
      ${metric(isPut ? 'Cushion to B/E' : 'Downside cushion', pct(c.cushion, 1))}
      ${isPut ? metric('Contracts affordable', n0(affordable)) : metric('If called away', smoney(c.calledAwayGain), cls(c.calledAwayGain))}
      ${metric(`Income × ${n}`, money(c.premiumTotal * n), 'pos')}
    </div>
    <div class="grid two">
      <div class="panel"><h4>Assignment risk</h4>
        <div class="row between" style="margin-bottom:8px"><span class="big num ${pRisk < 0.25 ? 'pos' : pRisk > 0.4 ? 'neg' : 'warn'}">${pct(pRisk, 0)}</span><span class="note" style="text-align:right">risk-neutral probability of<br>finishing in the money</span></div>
        <div class="meter"><i style="width:${(pRisk ?? 0) * 100}%;background:${pRisk < 0.25 ? 'var(--green)' : pRisk > 0.4 ? 'var(--red)' : 'var(--amber)'}"></i></div>
        <p class="note" style="margin-bottom:0">${isPut ? `If assigned: buy ${100 * n} shares at ${px(c.strike)} — net cost ${px(c.breakeven)}/share, ${pct(c.cushion, 1)} below today.` : `If called: shares sold at ${px(c.strike)}${params.basis ? ` vs. basis ${px(params.basis)}` : ''}.`}${c.earningsInWindow ? ' <span class="warn">Earnings before expiry.</span>' : ''}</p>
      </div>
      <div class="panel"><h4>Opportunity score · ${st.score}</h4><div class="bars">
        ${bar('Trend', st.weights.trend, b.trend)}${bar('Quality', st.weights.quality, b.quality)}${bar('Liquidity', st.weights.liquidity, b.liquidity)}${bar('Income', st.weights.income, b.income)}${bar('Risk', st.weights.risk, b.risk)}
      </div><p class="note" style="margin-bottom:0">Market regime ${esc(r.stock.regime.label)}: ${st.regimeAdj > 0 ? '+' : ''}${st.regimeAdj} pts. ${st.eligibleCount} of ${st.examinedCount} contracts passed filters.</p></div>
    </div>
    <div class="panel"><h4>Why it ${st.verdict === 'Avoid' ? 'falls short' : 'qualifies'}</h4><ul class="reasons">${st.reasons.map((x) => `<li class="good">${esc(x)}</li>`).join('')}${st.warnings.map((x) => `<li class="bad">${esc(x)}</li>`).join('')}</ul>
      ${nonSel.length ? `<p class="note" style="margin-bottom:0">${nonSel.map((x) => esc((x.reasons || []).join(' '))).join(' ')}</p>` : ''}</div>
    <details class="adv"><summary>Stock analysis</summary><div class="body stack">
      <div style="height:70px">${spark(m.spark, { w: 600, h: 70 })}</div>
      <div class="grid two">
        <dl class="kv">
          <dt>Price <span class="dim">(${esc(r.priceSource)})</span></dt><dd class="num">${px(r.price)}</dd>
          <dt>20 / 50 / 200-day SMA</dt><dd class="num">${[m.sma20, m.sma50, m.sma200].map((x) => (isNum(x) ? x.toFixed(2) : '—')).join(' / ')}</dd>
          <dt>1M / 3M change</dt><dd class="num"><span class="${cls(m.change1m)}">${spct(m.change1m)}</span> / <span class="${cls(m.change3m)}">${spct(m.change3m)}</span></dd>
          <dt>Realized vol 20d / 1y</dt><dd class="num">${pct(m.hv20)} / ${pct(m.hv252)}</dd>
          <dt>Max drawdown 1y</dt><dd class="num neg">${pct(-m.maxDrawdown1y)}</dd>
        </dl>
        <dl class="kv">
          <dt>Market cap</dt><dd class="num">${r.marketCap ? '$' + compact(r.marketCap) : '—'}</dd>
          <dt>Sector</dt><dd>${esc(r.sector || '—')}</dd>
          <dt>Net income (TTM)</dt><dd class="num ${cls(r.stock.fundamentals?.netIncome)}">${r.stock.fundamentals ? '$' + compact(r.stock.fundamentals.netIncome) : '—'}</dd>
          <dt>Next earnings</dt><dd class="${c.earningsInWindow ? 'warn' : ''}">${earn ? fdate(earn) : earn === false ? 'None in 90d' : 'Unavailable'}</dd>
          <dt>Next ex-dividend</dt><dd>${div ? `${fdate(div.exDate)}${div.amount ? ' · ' + px(div.amount) : ''}` : div === false ? 'None declared' : 'Unavailable'}</dd>
        </dl>
      </div>
      <div><div class="row between note"><span>52w low ${px(m.low52)}</span><span>${pct(m.fromHigh)} from high</span><span>52w high ${px(m.high52)}</span></div>${range != null ? `<div class="range52"><i style="left:${Math.min(100, Math.max(0, range))}%"></i></div>` : ''}</div>
      <div class="row wrap" style="gap:12px"><div style="flex:1;min-width:220px"><div class="note" style="margin-bottom:6px">Trend points</div>${scoreItems(r.stock.trend.items)}</div><div style="flex:1;min-width:220px"><div class="note" style="margin-bottom:6px">Quality points</div>${scoreItems(r.stock.quality.items)}</div><div style="flex:1;min-width:220px"><div class="note" style="margin-bottom:6px">Risk points</div>${scoreItems(c.scores.risk.items)}</div></div>
    </div></details>
    <div class="row wrap"><button class="btn primary" data-trade="${esc(r.symbol)}">Add to My Wheel</button><button class="btn" data-copy="${esc(r.symbol)}">Copy order</button><span class="spacer"></span><span class="note">Data ${esc(r.asOf)}</span></div>
  </div>`;
}

const scoreItems = (items) =>
  `<dl class="kv" style="font-size:12px">${items.map((i) => `<dt>${esc(i.label)}</dt><dd class="num ${i.earned == null ? 'dim' : ''}">${i.earned == null ? 'n/a' : `${i.earned}/${i.max}`}</dd>`).join('')}</dl>`;

function bindOppCards(root, getResult, params, onTrade = tradeFromOpportunity) {
  root.querySelectorAll('[data-toggle]').forEach((b) =>
    b.addEventListener('click', () => {
      const s = b.dataset.toggle;
      ui.open.has(s) ? ui.open.delete(s) : ui.open.add(s);
      rerenderCard(root, s, getResult, params, onTrade);
    }),
  );
  root.querySelectorAll('[data-seg^="tier:"],[data-seg^="strat:"]').forEach((b) =>
    b.addEventListener('click', () => {
      const [kind, sym] = b.dataset.seg.split(':');
      (kind === 'tier' ? ui.tier : ui.strat)[sym] = b.dataset.value;
      if (kind === 'strat') delete ui.tier[sym];
      rerenderCard(root, sym, getResult, params, onTrade);
    }),
  );
  root.querySelectorAll('[data-trade]').forEach((b) => b.addEventListener('click', () => onTrade(getResult(b.dataset.trade), params)));
  root.querySelectorAll('[data-copy]').forEach((b) =>
    b.addEventListener('click', async () => {
      const r = getResult(b.dataset.copy);
      const sk = stratKeyFor(r);
      const st = r.strategies[sk];
      const c = st.tiers[tierKeyFor(r, st)];
      const text = `SELL TO OPEN 1 ${r.symbol} ${c.expiration} ${c.strike} ${sk === 'csp' ? 'PUT' : 'CALL'} LMT ${c.premium.toFixed(2)}`;
      try {
        await navigator.clipboard.writeText(text);
        toast('Order copied');
      } catch {
        toast(text);
      }
    }),
  );
}

function rerenderCard(root, sym, getResult, params, onTrade) {
  const el = root.querySelector(`.opp[data-sym="${CSS.escape(sym)}"]`);
  if (!el) return;
  const r = getResult(sym);
  const rank = el.querySelector('.rank')?.textContent || '';
  const tmp = document.createElement('div');
  tmp.innerHTML = oppCard(r, rank, params, { hideRank: !rank });
  const fresh = tmp.firstElementChild;
  el.replaceWith(fresh);
  bindOppCards(fresh, getResult, params, onTrade);
}

afterRender.opportunities = () => {
  const v = $('#view');
  const scan = S.getState().lastScan;
  if (!scan) return;
  const get = (sym) => scan.results.find((x) => x.symbol === sym);
  v.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => ((ui.filter = b.dataset.filter), render())));
  $('#rescan')?.addEventListener('click', () => {
    location.hash = '#/scanner';
    setTimeout(runScan, 0);
  });
  v.querySelectorAll('[data-retry]').forEach((b) =>
    b.addEventListener('click', async () => {
      b.disabled = true;
      b.textContent = '…';
      try {
        const r = await api(analyzeQuery(b.dataset.retry, scan.params));
        const results = scan.results.map((x) => (x.symbol === r.symbol ? r : x));
        S.saveScan({ ...scan, results });
        toast(r.status === 'ok' ? `${r.symbol} analyzed` : `${r.symbol}: ${r.status}`);
      } catch (e) {
        toast(e.message, true);
        b.disabled = false;
        b.textContent = 'Retry';
      }
    }),
  );
  bindOppCards(v, get, scan.params);
};

function tradeFromOpportunity(r, params) {
  const sk = stratKeyFor(r);
  const st = r.strategies[sk];
  const c = st.tiers[tierKeyFor(r, st)];
  const fee = S.getState().settings.fee;
  if (sk === 'csp') {
    return openForm({
      title: `Sell ${r.symbol} put`,
      sub: `${fdate(c.expiration, true)} $${c.strike} put · enter your actual fill`,
      fields: [
        { name: 'contracts', label: 'Contracts', value: 1, step: 1, min: 1 },
        { name: 'premium', label: 'Fill price', prefix: '$', value: c.premium.toFixed(2), step: 0.01 },
        { name: 'strike', label: 'Strike', prefix: '$', value: c.strike },
        { name: 'expiration', label: 'Expiration', type: 'date', value: c.expiration },
        { name: 'fee', label: 'Fee per contract', prefix: '$', value: fee, step: 0.01 },
        { name: 'date', label: 'Trade date', type: 'date', value: S.today() },
      ],
      submit: 'Record trade',
      preview: (v) => `<p class="note">Collateral ${money(v.strike * 100 * v.contracts)} · premium ${money(v.premium * 100 * v.contracts)} · available after ${money(S.summary().available - v.strike * 100 * v.contracts + v.premium * 100 * v.contracts)}</p>`,
      onSubmit: (v) => {
        S.sellPut({ symbol: r.symbol, ...v, source: { score: st.score, verdict: st.verdict } });
        toast(`${r.symbol} put recorded`);
      },
    });
  }
  // Covered call: write against an existing lot when one has free shares, otherwise record a buy-write.
  const s = S.getState();
  const lot = s.positions.find((p) => p.kind === 'stock' && p.status === 'open' && p.symbol === r.symbol && p.shares - S.coveredShares(s, p.id) >= 100);
  if (lot) return sellCallForm(lot, c, { score: st.score, verdict: st.verdict });
  openForm({
    title: `Buy-write ${r.symbol}`,
    sub: `Buy shares and sell the ${fdate(c.expiration, true)} $${c.strike} call`,
    fields: [
      { name: 'contracts', label: 'Contracts (×100 shares)', value: 1, step: 1, min: 1 },
      { name: 'price', label: 'Share price paid', prefix: '$', value: r.price.toFixed(2), step: 0.01 },
      { name: 'premium', label: 'Call fill price', prefix: '$', value: c.premium.toFixed(2), step: 0.01 },
      { name: 'strike', label: 'Strike', prefix: '$', value: c.strike },
      { name: 'expiration', label: 'Expiration', type: 'date', value: c.expiration },
      { name: 'fee', label: 'Fee per contract', prefix: '$', value: fee, step: 0.01 },
      { name: 'date', label: 'Trade date', type: 'date', value: S.today() },
    ],
    submit: 'Record buy-write',
    onSubmit: (v) => {
      S.buyWrite({ symbol: r.symbol, ...v, source: { score: st.score, verdict: st.verdict } });
      toast(`${r.symbol} buy-write recorded`);
    },
  });
}

// ---------- MY WHEEL ----------
const STAGES = ['Put', 'Assigned', 'Shares', 'Call', 'Called'];

function viewWheel() {
  const st = S.getState();
  const sum = S.summary();
  const active = sum.activeCycles.slice().sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1));
  const done = sum.completedCycles.slice().sort((a, b) => (a.closedAt < b.closedAt ? 1 : -1));
  return `
  <div class="row between wrap" style="gap:12px"><div><div class="eyebrow">Lifecycle</div><h1 class="title">My Wheel</h1></div>
    <div class="row wrap"><button class="btn" id="undo" ${S.canUndo() ? '' : 'disabled'}>Undo</button><button class="btn" id="new-shares">+ Shares</button><button class="btn primary" id="new-put">+ Sell Put</button></div></div>
  <div class="grid kpi" style="margin:18px 0 6px">
    ${kpi('Available capital', money(sum.available), `${money(sum.cash)} cash`, sum.available < 0 ? 'neg' : '')}
    ${kpi('Put collateral', money(sum.reserved), `${sum.openPuts.length} open put${sum.openPuts.length === 1 ? '' : 's'}`)}
    ${kpi('Shares at cost', money(sum.stockAtCost), `${sum.lots.length} lot${sum.lots.length === 1 ? '' : 's'}`)}
    ${kpi('Open premium', money(sum.openPremium), `${sum.openPuts.length + sum.openCalls.length} short option${sum.openPuts.length + sum.openCalls.length === 1 ? '' : 's'}`, 'pos')}
  </div>
  <h2 class="section">Active cycles <span class="count">${active.length}</span></h2>
  ${active.length ? active.map((c) => cycleCard(c, st)).join('') : `<div class="card empty" style="padding:34px"><div class="icon">${ICON.wheel}</div><h3>No active wheels</h3><p>Record a cash-secured put from Opportunities, or add one manually.</p></div>`}
  ${done.length ? `<h2 class="section">Completed cycles <span class="count">${done.length}</span></h2><div class="mini-list">${done
    .map((c) => {
      const cs = S.cycleStats(c.id, st);
      const days = Math.max(1, Math.round((new Date(c.closedAt) - new Date(c.openedAt)) / 86400000));
      return `<div><span class="s">${esc(c.symbol)}</span><span class="muted" style="flex:1;font-size:12.5px">${fdate(c.openedAt)} → ${fdate(c.closedAt)} · ${days}d · ${cs.events.length} events</span><span class="num muted" style="font-size:12.5px">${cs.peakCapital ? pct(cs.realized / cs.peakCapital, 1) : ''}</span><b class="num ${cls(cs.realized)}">${smoney(cs.realized)}</b></div>`;
    })
    .join('')}</div>` : ''}`;
}

function cycleCard(c, st) {
  const cs = S.cycleStats(c.id, st);
  const open = cs.positions.filter((p) => p.status === 'open');
  const q = ui.quotes[c.symbol];
  return `<div class="cycle" data-cycle="${c.id}">
    <div class="row between"><div><div class="sym">${esc(c.symbol)} ${q ? `<span class="px num">${px(q.close)}</span>` : ''}</div><div class="note">Since ${fdate(c.openedAt)} · net premium <span class="pos">${money(cs.premium, 2)}</span>${cs.adjustedBasis != null ? ` · adj. basis ${px(cs.adjustedBasis)}` : ''}</div></div>
    <div style="text-align:right"><div class="num ${cls(cs.realized)}" style="font-weight:700">${smoney(cs.realized, 2)}</div><div class="note">realized</div></div></div>
    <div class="stepper">${STAGES.map((s, i) => `<div class="${i < cs.stage ? 'done' : i === cs.stage ? 'now' : ''}">${s}</div>`).join('')}</div>
    ${open.map((p) => positionRow(p, st, q)).join('')}
  </div>`;
}

function positionRow(p, st, q) {
  if (p.kind === 'stock') {
    const covered = S.coveredShares(st, p.id);
    const free = p.shares - covered;
    const unreal = q ? (q.close - p.cost) * p.shares : null;
    return `<div class="pos-row"><div class="row between wrap"><div><b>${n0(p.shares)} shares</b> <span class="muted">@ ${px(p.cost)}</span> ${covered ? `<span class="pill tag">${covered} covered</span>` : ''}</div>${unreal != null ? `<div class="num ${cls(unreal)}">${smoney(unreal)} <span class="note">unrealized</span></div>` : ''}</div>
      <div class="actions">${free >= 100 ? `<button class="btn sm primary" data-act="call" data-id="${p.id}">Sell call</button><button class="btn sm" data-act="findcalls" data-id="${p.id}">Find calls</button>` : ''}${free > 0 ? `<button class="btn sm" data-act="sellshares" data-id="${p.id}">Sell shares</button>` : ''}</div></div>`;
  }
  const isPut = p.kind === 'csp';
  const dte = daysTo(p.expiration);
  const itm = q ? (isPut ? q.close < p.strike : q.close > p.strike) : null;
  return `<div class="pos-row"><div class="row between wrap"><div><span class="pill tag">${isPut ? 'CSP' : 'CC'}</span> <b class="num">${p.contracts} × $${p.strike} ${isPut ? 'put' : 'call'}</b> <span class="muted">· ${fdate(p.expiration)}</span></div>
      <div class="num" style="text-align:right"><span class="pos">${money(p.premium * 100 * p.contracts, 2)}</span> <span class="note">${dte >= 0 ? `${dte}d left` : 'past expiry'}${itm != null ? ` · <span class="${itm ? 'neg' : 'pos'}">${itm ? 'ITM' : 'OTM'}</span>` : ''}</span></div></div>
    <div class="actions"><button class="btn sm" data-act="expire" data-id="${p.id}">Expired</button><button class="btn sm" data-act="btc" data-id="${p.id}">Buy to close</button><button class="btn sm" data-act="roll" data-id="${p.id}">Roll</button>${isPut ? `<button class="btn sm danger" data-act="assign" data-id="${p.id}">Assigned</button>` : `<button class="btn sm danger" data-act="called" data-id="${p.id}">Called away</button>`}</div></div>`;
}

function sellPutForm() {
  const fee = S.getState().settings.fee;
  openForm({
    title: 'Sell cash-secured put',
    fields: [
      { name: 'symbol', label: 'Ticker', type: 'text', value: '' },
      { name: 'contracts', label: 'Contracts', value: 1, step: 1, min: 1 },
      { name: 'strike', label: 'Strike', prefix: '$', value: '' },
      { name: 'premium', label: 'Premium per share', prefix: '$', value: '', step: 0.01 },
      { name: 'expiration', label: 'Expiration', type: 'date', value: '' },
      { name: 'fee', label: 'Fee per contract', prefix: '$', value: fee, step: 0.01 },
      { name: 'date', label: 'Trade date', type: 'date', value: S.today() },
    ],
    submit: 'Record put',
    onSubmit: (v) => (S.sellPut(v), toast('Put recorded')),
  });
}

function sellCallForm(lot, c, source) {
  const st = S.getState();
  const free = lot.shares - S.coveredShares(st, lot.id);
  openForm({
    title: `Sell ${lot.symbol} covered call`,
    sub: `${free} uncovered shares @ ${px(lot.cost)}`,
    fields: [
      { name: 'contracts', label: 'Contracts', value: Math.max(1, Math.floor(free / 100)), step: 1, min: 1, max: Math.floor(free / 100) },
      { name: 'strike', label: 'Strike', prefix: '$', value: c?.strike ?? '' },
      { name: 'premium', label: 'Premium per share', prefix: '$', value: c ? c.premium.toFixed(2) : '', step: 0.01 },
      { name: 'expiration', label: 'Expiration', type: 'date', value: c?.expiration ?? '' },
      { name: 'fee', label: 'Fee per contract', prefix: '$', value: st.settings.fee, step: 0.01 },
      { name: 'date', label: 'Trade date', type: 'date', value: S.today() },
    ],
    submit: 'Record call',
    preview: (v) => (Number(v.strike) && Number(v.strike) < lot.cost ? `<div class="banner">Strike is below your cost of ${px(lot.cost)} — assignment would lock in a stock loss.</div>` : ''),
    onSubmit: (v) => (S.sellCall({ lotId: lot.id, ...v, source }), toast('Covered call recorded')),
  });
}

async function findCalls(lot) {
  const st = S.getState();
  const cs = S.cycleStats(lot.cycleId, st);
  const basis = cs.adjustedBasis ?? lot.cost;
  const params = { ...st.settings, strategy: 'cc', capital: st.settings.capital };
  const sheet = openSheet(`<h3>Covered calls · ${esc(lot.symbol)}</h3><div class="sub">Strikes at or above your adjusted basis of ${px(basis)}</div><div id="fc"><div class="skeleton" style="height:90px"></div></div><div class="foot"><button class="btn ghost" data-close>Close</button></div>`);
  try {
    const r = await api(analyzeQuery(lot.symbol, params, { basis: basis.toFixed(2) }));
    const box = $('#fc', sheet);
    if (!box) return;
    if (r.status !== 'ok') {
      box.innerHTML = `<div class="banner">${esc([r.error, ...(r.reasons || []), ...Object.values(r.strategies || {}).flatMap((x) => x.reasons || [])].filter(Boolean).join(' · ') || 'No suitable calls found')}</div>`;
      return;
    }
    ui.open.add(r.symbol);
    const p2 = { ...params, basis };
    box.innerHTML = oppCard(r, '', p2, { hideRank: true });
    bindOppCards(box, () => r, p2, () => {
      const st2 = r.strategies.cc;
      const c = st2.tiers[tierKeyFor(r, st2)];
      sellCallForm(lot, c, { score: st2.score, verdict: st2.verdict });
    });
  } catch (e) {
    const box = $('#fc', sheet);
    if (box) box.innerHTML = `<div class="banner err">${esc(e.message)}</div>`;
  }
}

afterRender.wheel = () => {
  const v = $('#view');
  $('#new-put').addEventListener('click', sellPutForm);
  $('#undo').addEventListener('click', () => (S.undo() ? toast('Last action undone') : null));
  $('#new-shares').addEventListener('click', () =>
    openForm({
      title: 'Add shares',
      sub: 'Start a wheel from shares you already own or buy',
      fields: [
        { name: 'symbol', label: 'Ticker', type: 'text', value: '' },
        { name: 'shares', label: 'Shares', value: 100, step: 1, min: 1 },
        { name: 'price', label: 'Price per share', prefix: '$', value: '', step: 0.01 },
        { name: 'fee', label: 'Total fee', prefix: '$', value: 0, step: 0.01 },
        { name: 'date', label: 'Date', type: 'date', value: S.today() },
      ],
      submit: 'Add shares',
      onSubmit: (x) => (S.buyShares(x), toast('Shares added')),
    }),
  );
  const st = S.getState();
  v.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', () => {
      const p = st.positions.find((x) => x.id === b.dataset.id);
      if (!p) return;
      const fee = st.settings.fee;
      const label = `${p.symbol} $${p.strike} ${p.kind === 'csp' ? 'put' : 'call'}`;
      switch (b.dataset.act) {
        case 'expire':
          return openForm({ title: 'Expired worthless', sub: `${label} — keep the full premium`, fields: [{ name: 'date', label: 'Date', type: 'date', value: p.expiration <= S.today() ? p.expiration : S.today() }], submit: 'Confirm', onSubmit: (x) => (S.closeOption(p.id, { how: 'expired', date: x.date }), toast('Marked expired')) });
        case 'btc':
          return openForm({ title: 'Buy to close', sub: label, fields: [{ name: 'price', label: 'Price per share', prefix: '$', value: '', step: 0.01 }, { name: 'fee', label: 'Fee per contract', prefix: '$', value: fee, step: 0.01 }, { name: 'date', label: 'Date', type: 'date', value: S.today() }], submit: 'Close position', preview: (x) => (x.price !== '' ? `<p class="note">Realized: <b class="${cls(p.premium - x.price)}">${smoney((p.premium - x.price) * 100 * p.contracts - p.openFee - x.fee * p.contracts, 2)}</b></p>` : ''), onSubmit: (x) => (S.closeOption(p.id, { how: 'btc', ...x }), toast('Position closed')) });
        case 'roll':
          return openForm({ title: 'Roll position', sub: `${label} → new contract`, fields: [{ name: 'closePrice', label: 'Buy back at', prefix: '$', value: '', step: 0.01 }, { name: 'premium', label: 'New premium', prefix: '$', value: '', step: 0.01 }, { name: 'strike', label: 'New strike', prefix: '$', value: p.strike }, { name: 'expiration', label: 'New expiration', type: 'date', value: '' }, { name: 'fee', label: 'Fee per contract (each leg)', prefix: '$', value: fee, step: 0.01 }, { name: 'date', label: 'Date', type: 'date', value: S.today() }], submit: 'Roll', preview: (x) => (x.closePrice !== '' && x.premium !== '' ? `<p class="note">Net ${x.premium - x.closePrice >= 0 ? 'credit' : 'debit'}: <b class="${cls(x.premium - x.closePrice)}">${money(Math.abs(x.premium - x.closePrice) * 100 * p.contracts, 2)}</b></p>` : ''), onSubmit: (x) => (S.rollOption(p.id, x), toast('Rolled')) });
        case 'assign':
          return openForm({ title: 'Put assigned', sub: `Buy ${p.contracts * 100} ${p.symbol} at ${px(p.strike)} — premium kept, cycle moves to shares`, fields: [{ name: 'fee', label: 'Assignment fee', prefix: '$', value: 0, step: 0.01 }, { name: 'date', label: 'Date', type: 'date', value: p.expiration <= S.today() ? p.expiration : S.today() }], submit: 'Record assignment', danger: true, onSubmit: (x) => (S.assignPut(p.id, x), toast(`Assigned ${p.contracts * 100} ${p.symbol}`)) });
        case 'called':
          return openForm({ title: 'Shares called away', sub: `Sell ${p.contracts * 100} ${p.symbol} at ${px(p.strike)}`, fields: [{ name: 'fee', label: 'Assignment fee', prefix: '$', value: 0, step: 0.01 }, { name: 'date', label: 'Date', type: 'date', value: p.expiration <= S.today() ? p.expiration : S.today() }], submit: 'Record call-away', danger: true, onSubmit: (x) => (S.callAway(p.id, x), toast('Shares called away')) });
        case 'call':
          return sellCallForm(p);
        case 'findcalls':
          return findCalls(p);
        case 'sellshares': {
          const free = p.shares - S.coveredShares(st, p.id);
          return openForm({ title: `Sell ${p.symbol} shares`, fields: [{ name: 'shares', label: 'Shares', value: free, step: 1, min: 1, max: free }, { name: 'price', label: 'Price per share', prefix: '$', value: ui.quotes[p.symbol]?.close ?? '', step: 0.01 }, { name: 'fee', label: 'Total fee', prefix: '$', value: 0, step: 0.01 }, { name: 'date', label: 'Date', type: 'date', value: S.today() }], submit: 'Sell', preview: (x) => (x.price ? `<p class="note">Realized: <b class="${cls(x.price - p.cost)}">${smoney((x.price - p.cost) * x.shares - x.fee, 2)}</b></p>` : ''), onSubmit: (x) => (S.sellShares(p.id, x), toast('Shares sold')) });
        }
      }
    }),
  );
  loadQuotes();
};

let quotesInflight = false;
async function loadQuotes() {
  const st = S.getState();
  const syms = [...new Set(st.positions.filter((p) => p.status === 'open').map((p) => p.symbol))].filter((s) => !ui.quotes[s] || Date.now() - ui.quotes[s].at > 5 * 60 * 1000);
  if (!syms.length || quotesInflight || !ui.health?.configured) return;
  quotesInflight = true;
  try {
    const r = await api(`/api/quotes?symbols=${syms.slice(0, 50).join(',')}`);
    for (const [k, v] of Object.entries(r.quotes)) if (v) ui.quotes[k] = { ...v, at: Date.now() };
    if (route() === 'wheel') render();
  } catch {
    // Mark-to-market is optional; positions still display without it.
  } finally {
    quotesInflight = false;
  }
}

// ---------- INCOME ----------
const EVENT_LABEL = { sell_put: 'Sell put', sell_call: 'Sell call', btc: 'Buy to close', expired: 'Expired', assigned: 'Assigned', called_away: 'Called away', buy_shares: 'Buy shares', sell_shares: 'Sell shares' };
let journalFilter = '';

function viewIncome() {
  const st = S.getState();
  const sum = S.summary();
  const months = S.monthlyPremium(12);
  const exp = [...sum.openPuts, ...sum.openCalls].sort((a, b) => (a.expiration < b.expiration ? -1 : 1));
  const journal = st.journal.filter((e) => !journalFilter || e.symbol.includes(journalFilter.toUpperCase())).slice().sort((a, b) => (a.date === b.date ? b.ts - a.ts : a.date < b.date ? 1 : -1));
  const wins = sum.completedCycles.map((c) => S.cycleStats(c.id, st).realized);
  return `
  <div class="eyebrow">Performance</div><h1 class="title">Income</h1>
  <div class="grid kpi" style="margin:18px 0 12px">
    ${kpi('This week', money(sum.premiumWeek), 'net premium', cls(sum.premiumWeek))}
    ${kpi('This month', money(sum.premiumMonth), 'net premium', cls(sum.premiumMonth))}
    ${kpi('This year', money(sum.premiumYear), 'net premium', cls(sum.premiumYear))}
    ${kpi('Realized P/L', smoney(sum.realizedYear), `YTD · ${smoney(sum.realizedAll)} all-time`, cls(sum.realizedYear))}
    ${kpi('Available capital', money(sum.available), `of ${money(sum.cash)} cash`)}
    ${kpi('Active trades', n0(sum.activeTrades), `${sum.activeCycles.length} active cycle${sum.activeCycles.length === 1 ? '' : 's'}`)}
    ${kpi('Completed cycles', n0(sum.completedCycles.length), wins.length ? `${Math.round((wins.filter((w) => w > 0).length / wins.length) * 100)}% profitable` : '—')}
    ${kpi('Return on capital', pct(st.settings.capital ? sum.realizedAll / st.settings.capital : null, 2), 'realized, all-time', cls(sum.realizedAll))}
  </div>
  <div class="card"><div class="row between"><div class="eyebrow">Net premium · 12 months</div><div class="num muted" style="font-size:13px">${money(months.reduce((a, m) => a + m.premium, 0))}</div></div>${barChart(months)}</div>
  <h2 class="section">Upcoming expirations <span class="count">${exp.length}</span></h2>
  ${exp.length ? `<div class="mini-list">${exp.map((p) => { const d = daysTo(p.expiration); return `<div><span class="s">${esc(p.symbol)}</span><span class="pill tag">${p.kind === 'csp' ? 'CSP' : 'CC'}</span><span class="num" style="flex:1">${p.contracts} × $${p.strike}</span><span class="num ${d <= 3 ? 'warn' : 'muted'}">${fdate(p.expiration)} · ${d >= 0 ? d + 'd' : 'past'}</span><b class="num pos">${money(p.premium * 100 * p.contracts)}</b></div>`; }).join('')}</div>` : `<p class="muted">No open options.</p>`}
  <div class="row between wrap" style="margin:28px 0 12px;gap:10px"><h2 class="section" style="margin:0">Trade journal <span class="count">${st.journal.length}</span></h2>
    <div class="row"><input class="input" id="jfilter" placeholder="Filter ticker" value="${esc(journalFilter)}" style="width:140px;padding:8px 12px" autocapitalize="characters"><button class="btn sm" id="csv" ${st.journal.length ? '' : 'disabled'}>Export CSV</button></div></div>
  ${journal.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Ticker</th><th>Event</th><th class="r">Qty</th><th class="r">Strike</th><th class="r">Price</th><th class="r">Cash</th><th class="r">Realized</th></tr></thead><tbody>${journal.map((e) => `<tr><td class="num">${esc(e.date)}</td><td><b>${esc(e.symbol)}</b></td><td>${EVENT_LABEL[e.type] || esc(e.type)}${e.note ? ` <span class="dim">· ${esc(e.note)}</span>` : ''}</td><td class="r num">${n0(e.qty)}</td><td class="r num">${e.strike ? px(e.strike) : ''}</td><td class="r num">${isNum(e.price) ? px(e.price) : ''}</td><td class="r num ${cls(e.cash)}">${smoney(e.cash, 2)}</td><td class="r num ${cls(e.realized)}">${e.realized ? smoney(e.realized, 2) : ''}</td></tr>`).join('')}</tbody></table></div>` : `<p class="muted">${st.journal.length ? 'No matching entries.' : 'Trades you record appear here.'}</p>`}`;
}

function barChart(months) {
  const W = 600;
  const H = 200;
  const pad = { t: 16, b: 24, l: 4, r: 4 };
  const vals = months.map((m) => m.premium);
  const max = Math.max(1, ...vals);
  const min = Math.min(0, ...vals);
  const span = max - min;
  const y = (v) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
  const bw = (W - pad.l - pad.r) / months.length;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly net premium">
    <line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line-2)"/>
    ${months.map((m, i) => { const x = pad.l + i * bw + bw * 0.18; const h = Math.abs(y(m.premium) - y(0)); return `<g><title>${m.label}: ${money(m.premium, 2)}</title><rect x="${x}" y="${m.premium >= 0 ? y(m.premium) : y(0)}" width="${bw * 0.64}" height="${Math.max(m.premium ? 2 : 0, h)}" rx="4" fill="${m.premium >= 0 ? 'var(--green)' : 'var(--red)'}" opacity="${i === months.length - 1 ? 1 : 0.7}"/>${m.premium ? `<text x="${x + bw * 0.32}" y="${(m.premium >= 0 ? y(m.premium) : y(0) + h) + (m.premium >= 0 ? -5 : 12)}" text-anchor="middle">${compact(Math.round(m.premium))}</text>` : ''}<text x="${x + bw * 0.32}" y="${H - 6}" text-anchor="middle">${m.label}</text></g>`; }).join('')}
  </svg>`;
}

afterRender.income = () => {
  const f = $('#jfilter');
  f?.addEventListener('input', () => {
    journalFilter = f.value.trim();
    const pos = f.selectionStart;
    render();
    const nf = $('#jfilter');
    nf.focus();
    nf.setSelectionRange(pos, pos);
  });
  $('#csv')?.addEventListener('click', () => {
    const rows = [['date', 'symbol', 'event', 'qty', 'strike', 'price', 'cash', 'realized', 'note']];
    for (const e of S.getState().journal) rows.push([e.date, e.symbol, e.type, e.qty, e.strike ?? '', e.price ?? '', e.cash, e.realized, e.note ?? '']);
    download('wheel-journal.csv', rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
  });
};

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- SETTINGS ----------
function viewSettings() {
  const s = S.getState().settings;
  const h = ui.health;
  const ent = h?.entitlements || {};
  const row = (k, v) => `<div><span style="flex:1">${k}</span><span class="pill ${v === 'ok' ? 'strong' : v === 'not entitled' ? 'watch' : v ? 'avoid' : 'unverified'}">${v === 'ok' ? 'Connected' : v || 'Unknown'}</span></div>`;
  return `
  <div class="eyebrow">Preferences</div><h1 class="title">Settings</h1>
  <h2 class="section">Account</h2>
  <div class="card form-grid">
    <div class="field"><label>Starting capital</label><div class="input-wrap"><span class="prefix">$</span><input class="input num" type="number" min="100" step="500" data-setting="capital" value="${s.capital}"></div></div>
    <div class="field"><label>Commission per contract</label><div class="input-wrap"><span class="prefix">$</span><input class="input num" type="number" min="0" step="0.05" data-setting="fee" value="${s.fee}"></div></div>
  </div>
  <h2 class="section">Scanner defaults</h2>
  <div class="card form-grid">
    <div class="field"><label>Risk tolerance</label>${seg('risk', [['conservative', 'Conservative'], ['balanced', 'Balanced'], ['aggressive', 'Aggressive']], s.risk, 'class="seg small"')}</div>
    <div class="field"><label>Income target (monthly)</label><div class="input-wrap"><input class="input num" type="number" min="0.5" max="4" step="0.25" data-setting="target" value="${s.target}"><span class="suffix">%</span></div></div>
    <div class="field"><label>Min days to expiration</label><input class="input num" type="number" min="1" max="120" data-setting="dteMin" value="${s.dteMin}"></div>
    <div class="field"><label>Max days to expiration</label><input class="input num" type="number" min="1" max="180" data-setting="dteMax" value="${s.dteMax}"></div>
    <div class="field"><label>Min open interest</label><input class="input num" type="number" min="0" step="50" data-setting="minOI" value="${s.minOI}"></div>
    <div class="field"><label>Max bid/ask spread</label><div class="input-wrap"><input class="input num" type="number" min="1" max="100" data-setting="maxSpread" value="${s.maxSpread}"><span class="suffix">%</span></div></div>
    <div class="field"><label>Results shown (10–20)</label><input class="input num" type="number" min="10" max="20" data-setting="results" value="${s.results}"></div>
    <div class="field"><label>Risk-free rate</label><div class="input-wrap"><input class="input num" type="number" min="0" max="20" step="0.25" data-setting="rate" value="${s.rate}"><span class="suffix">%</span></div></div>
  </div>
  <h2 class="section">Market data</h2>
  <div class="card stack">
    <div class="row between"><div><b>${esc(h?.provider || 'Massive.com')}</b><div class="note">${!h ? 'Checking…' : h.error ? esc(h.error) : h.configured ? 'API key configured on the server' : 'MASSIVE_API_KEY is not set on the server'}</div></div><button class="btn sm" id="recheck">Test connection</button></div>
    ${h?.configured ? `<div class="mini-list">${row('Stock prices & history', ent.stocks)}${row('Options chains, Greeks & quotes', ent.options)}${row('Reference & fundamentals', ent.reference)}${row('Earnings calendar', ent.earnings)}</div>` : ''}
    <p class="note" style="margin:0">The key lives only in the Vercel environment and is never sent to the browser. Missing entitlements mark affected opportunities <b>Unverified</b> — no values are estimated in their place.</p>
  </div>
  <h2 class="section">Data</h2>
  <div class="card row wrap"><button class="btn" id="export">Export backup</button><label class="btn" for="import">Import backup</label><input id="import" type="file" accept="application/json,.json" class="hidden"><span class="spacer"></span><button class="btn danger" id="reset">Reset all data</button></div>
  <h2 class="section">Methodology</h2>
  <div class="card note" style="font-size:13px;line-height:1.65">
    <p style="margin-top:0"><b style="color:var(--text)">Strike tiers.</b> Conservative |Δ| 0.08–0.20, Balanced 0.18–0.30, Aggressive 0.28–0.42. Within each band the contract with the best blend of income, liquidity and risk (favoring ~30 DTE) is chosen. Contracts must be out of the money, quoted, within your spread, open-interest, expiration and capital limits.</p>
    <p><b style="color:var(--text)">Opportunity Score.</b> Trend 20% (price vs 50/200-day SMA, slope, 52-week high) · Quality 15% (market cap, realized volatility, drawdown, profitability) · Liquidity 20% (open interest, volume, spread) · Income 20% (monthly-equivalent return vs your target) · Risk 25% (probability OTM, break-even vs expected move, IV/HV, earnings and dividend timing) · Market regime ±. Components without data are excluded and the remaining weights re-normalized; every point is shown in the card.</p>
    <p><b style="color:var(--text)">Verdicts.</b> Strong Candidate ≥ 75 · Favorable ≥ 62 · Watch ≥ 48 · Avoid below. Earnings before expiry, or a put on a stock below both its 50- and 200-day averages, caps the verdict at Watch.</p>
    <p style="margin-bottom:0"><b style="color:var(--text)">Probabilities.</b> Black-Scholes risk-neutral N(d₂) using the contract's own implied volatility and your risk-free rate. Shown only when the provider supplies IV. They describe market pricing, not a forecast.</p>
  </div>`;
}

afterRender.settings = () => {
  const v = $('#view');
  bindSettingInputs(v);
  v.querySelectorAll('[data-seg]').forEach((b) => b.addEventListener('click', () => S.updateSettings({ [b.dataset.seg]: b.dataset.value })));
  $('#recheck').addEventListener('click', () => checkHealth(true));
  $('#export').addEventListener('click', () => download(`wheel-command-${S.today()}.json`, S.exportState(), 'application/json'));
  $('#import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      S.importState(JSON.parse(await f.text()));
      toast('Backup imported');
    } catch (err) {
      toast(err.message || 'Import failed', true);
    }
  });
  $('#reset').addEventListener('click', () => confirmSheet('Reset all data?', 'Deletes every trade, cycle, journal entry, scan and setting on this device. Export a backup first if you may need it.', 'Reset everything', () => (S.resetAll(), toast('All data reset'))));
};

// ---------- boot ----------
async function checkHealth(announce) {
  try {
    ui.health = await api('/api/health');
  } catch (e) {
    ui.health = { error: e.message };
  }
  if (announce) toast(ui.health.error ? ui.health.error : ui.health.configured ? 'Connection checked' : 'No API key configured', Boolean(ui.health.error || !ui.health.configured));
  if (ui.health.configured && !ui.regime) loadRegime();
  if (!ui.scan?.running) render();
}

async function loadRegime() {
  try {
    ui.regime = await api('/api/market');
    ui.regimeErr = null;
  } catch (e) {
    ui.regimeErr = e.message;
  }
  if (route() === 'scanner' && !ui.scan?.running) render();
}

async function loadMarkets() {
  try {
    ui.markets = (await api('/api/universe')).markets;
    if (route() === 'scanner' && !ui.scan?.running) render();
  } catch {}
}

render();
checkHealth();
loadMarkets();
