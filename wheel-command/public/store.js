// Wheel ledger: settings, cycles, positions and an append-only journal,
// persisted in localStorage. Every action records a journal event carrying its
// cash flow and realized P/L so all dashboard figures are derived, not stored.

const KEY = 'wheelcommand.v1';
const UNDO_KEY = 'wheelcommand.undo';
const UNDO_DEPTH = 25;

export const DEFAULT_SETTINGS = {
  capital: 50000,
  fee: 0.65,
  market: 'sp100',
  strategy: 'csp',
  risk: 'balanced',
  dteMin: 15,
  dteMax: 45,
  target: 1.5,
  results: 15,
  minOI: 100,
  maxSpread: 12,
  rate: 4,
};

const blank = () => ({ version: 1, settings: { ...DEFAULT_SETTINGS }, cycles: [], positions: [], journal: [], lastScan: null });

const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k));
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

let state = (() => {
  const s = read(KEY);
  if (!s || s.version !== 1) return blank();
  return { ...blank(), ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings } };
})();
let undoStack = read(UNDO_KEY) || [];
const listeners = new Set();

export const getState = () => state;
export const subscribe = (fn) => (listeners.add(fn), () => listeners.delete(fn));
const persist = () => {
  if (!write(KEY, state)) {
    // Storage full: drop the cached scan first, it is re-creatable.
    state.lastScan = null;
    write(KEY, state);
  }
  listeners.forEach((fn) => fn(state));
};

function commit(mutator) {
  const snapshot = JSON.stringify({ ...state, lastScan: null });
  const next = structuredClone(state);
  mutator(next);
  undoStack.push(snapshot);
  if (undoStack.length > UNDO_DEPTH) undoStack.shift();
  write(UNDO_KEY, undoStack);
  state = next;
  persist();
}

export const canUndo = () => undoStack.length > 0;
export function undo() {
  const prev = undoStack.pop();
  if (!prev) return false;
  const restored = JSON.parse(prev);
  state = { ...restored, lastScan: state.lastScan };
  write(UNDO_KEY, undoStack);
  persist();
  return true;
}

export function updateSettings(patch) {
  state = { ...state, settings: { ...state.settings, ...patch } };
  persist();
}
export function saveScan(scan) {
  state = { ...state, lastScan: scan };
  persist();
}
export function resetAll() {
  state = blank();
  undoStack = [];
  write(UNDO_KEY, undoStack);
  persist();
}
export function importState(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.journal) || !Array.isArray(data.positions) || !Array.isArray(data.cycles)) throw new Error('Not a Wheel Command export');
  commit((s) => {
    Object.assign(s, { ...blank(), ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings }, lastScan: s.lastScan });
  });
}
export const exportState = () => JSON.stringify({ ...state, lastScan: null, exportedAt: new Date().toISOString() }, null, 2);

// ---------- helpers ----------

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)).slice(0, 12);
export const today = () => new Date().toLocaleDateString('en-CA');
const r2 = (x) => Math.round(x * 100) / 100;
const need = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const posNum = (v, name) => {
  const n = Number(v);
  need(Number.isFinite(n) && n > 0, `${name} must be greater than zero`);
  return n;
};
const nonNeg = (v, name) => {
  const n = Number(v ?? 0);
  need(Number.isFinite(n) && n >= 0, `${name} cannot be negative`);
  return n;
};
const validDate = (d) => (need(/^\d{4}-\d{2}-\d{2}$/.test(d || ''), 'Enter a valid date'), d);

function event(s, e) {
  s.journal.push({ id: uid(), ts: Date.now(), cash: 0, realized: 0, ...e, cash: r2(e.cash ?? 0), realized: r2(e.realized ?? 0) });
}

function maybeCompleteCycle(s, cycleId, date) {
  const open = s.positions.some((p) => p.cycleId === cycleId && p.status === 'open');
  if (!open) {
    const c = s.cycles.find((x) => x.id === cycleId);
    if (c && c.status === 'active') Object.assign(c, { status: 'completed', closedAt: date });
  }
}

const openPos = (s, id) => {
  const p = s.positions.find((x) => x.id === id);
  need(p && p.status === 'open', 'Position not found or already closed');
  return p;
};

export function coveredShares(s, lotId) {
  return s.positions.filter((p) => p.kind === 'cc' && p.status === 'open' && p.lotId === lotId).reduce((a, p) => a + p.contracts * 100, 0);
}

// ---------- actions ----------

export function sellPut({ symbol, strike, expiration, contracts, premium, fee, date, note, source }) {
  symbol = String(symbol || '').toUpperCase().trim();
  need(/^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol), 'Enter a valid ticker');
  strike = posNum(strike, 'Strike');
  contracts = Math.round(posNum(contracts, 'Contracts'));
  premium = posNum(premium, 'Premium');
  fee = nonNeg(fee, 'Fee');
  validDate(expiration);
  date = validDate(date || today());
  need(expiration >= date, 'Expiration must be on or after the trade date');
  commit((s) => {
    const cycleId = uid();
    s.cycles.push({ id: cycleId, symbol, status: 'active', openedAt: date, closedAt: null, start: 'put' });
    const id = uid();
    s.positions.push({ id, cycleId, kind: 'csp', symbol, strike, expiration, contracts, premium, openFee: r2(fee * contracts), openedAt: date, status: 'open', note: note || '', source: source || null });
    event(s, { date, cycleId, positionId: id, symbol, type: 'sell_put', qty: contracts, price: premium, strike, expiration, cash: premium * 100 * contracts - fee * contracts, note });
  });
}

export function buyShares({ symbol, shares, price, fee, date, note }) {
  symbol = String(symbol || '').toUpperCase().trim();
  need(/^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol), 'Enter a valid ticker');
  shares = Math.round(posNum(shares, 'Shares'));
  price = posNum(price, 'Price');
  fee = nonNeg(fee, 'Fee');
  date = validDate(date || today());
  commit((s) => {
    const cycleId = uid();
    s.cycles.push({ id: cycleId, symbol, status: 'active', openedAt: date, closedAt: null, start: 'shares' });
    const id = uid();
    s.positions.push({ id, cycleId, kind: 'stock', symbol, shares, cost: r2(price + fee / shares), openedAt: date, status: 'open', note: note || '' });
    event(s, { date, cycleId, positionId: id, symbol, type: 'buy_shares', qty: shares, price, cash: -(price * shares + fee), note });
  });
}

export function sellCall({ lotId, strike, expiration, contracts, premium, fee, date, note, source }) {
  strike = posNum(strike, 'Strike');
  contracts = Math.round(posNum(contracts, 'Contracts'));
  premium = posNum(premium, 'Premium');
  fee = nonNeg(fee, 'Fee');
  validDate(expiration);
  date = validDate(date || today());
  need(expiration >= date, 'Expiration must be on or after the trade date');
  commit((s) => {
    const lot = openPos(s, lotId);
    need(lot.kind === 'stock', 'Covered calls must be written against a share lot');
    const free = lot.shares - coveredShares(s, lotId);
    need(contracts * 100 <= free, `Only ${Math.floor(free / 100)} contract(s) can be covered by this lot`);
    const id = uid();
    s.positions.push({ id, cycleId: lot.cycleId, kind: 'cc', lotId, symbol: lot.symbol, strike, expiration, contracts, premium, openFee: r2(fee * contracts), openedAt: date, status: 'open', note: note || '', source: source || null });
    event(s, { date, cycleId: lot.cycleId, positionId: id, symbol: lot.symbol, type: 'sell_call', qty: contracts, price: premium, strike, expiration, cash: premium * 100 * contracts - fee * contracts, note });
  });
}

// Expire worthless or buy to close.
export function closeOption(id, { how, price = 0, fee = 0, date }) {
  need(how === 'expired' || how === 'btc', 'Unknown close type');
  price = how === 'expired' ? 0 : nonNeg(price, 'Buy-back price');
  fee = how === 'expired' ? 0 : nonNeg(fee, 'Fee');
  date = validDate(date || today());
  commit((s) => {
    const p = openPos(s, id);
    need(p.kind === 'csp' || p.kind === 'cc', 'Not an option position');
    const debit = price * 100 * p.contracts + fee * p.contracts;
    const realized = p.premium * 100 * p.contracts - p.openFee - debit;
    Object.assign(p, { status: 'closed', closedAt: date, closeReason: how, closePrice: price, realized: r2(realized) });
    event(s, { date, cycleId: p.cycleId, positionId: id, symbol: p.symbol, type: how, kind: p.kind, qty: p.contracts, price, strike: p.strike, cash: -debit, realized });
    maybeCompleteCycle(s, p.cycleId, date);
  });
}

export function assignPut(id, { date, fee = 0 }) {
  date = validDate(date || today());
  fee = nonNeg(fee, 'Fee');
  commit((s) => {
    const p = openPos(s, id);
    need(p.kind === 'csp', 'Only puts can be assigned');
    const realized = p.premium * 100 * p.contracts - p.openFee;
    Object.assign(p, { status: 'closed', closedAt: date, closeReason: 'assigned', closePrice: 0, realized: r2(realized) });
    const shares = p.contracts * 100;
    const lotId = uid();
    s.positions.push({ id: lotId, cycleId: p.cycleId, kind: 'stock', symbol: p.symbol, shares, cost: r2(p.strike + fee / shares), openedAt: date, status: 'open', fromPut: id });
    event(s, { date, cycleId: p.cycleId, positionId: id, symbol: p.symbol, type: 'assigned', qty: shares, price: p.strike, strike: p.strike, cash: -(p.strike * shares + fee), realized });
  });
}

export function callAway(id, { date, fee = 0 }) {
  date = validDate(date || today());
  fee = nonNeg(fee, 'Fee');
  commit((s) => {
    const p = openPos(s, id);
    need(p.kind === 'cc', 'Only covered calls can be called away');
    const lot = s.positions.find((x) => x.id === p.lotId);
    need(lot && lot.status === 'open', 'Share lot not found');
    const shares = p.contracts * 100;
    const optRealized = p.premium * 100 * p.contracts - p.openFee;
    const stockRealized = (p.strike - lot.cost) * shares - fee;
    Object.assign(p, { status: 'closed', closedAt: date, closeReason: 'called', closePrice: 0, realized: r2(optRealized) });
    lot.shares -= shares;
    lot.realized = r2((lot.realized || 0) + stockRealized);
    if (lot.shares <= 0) Object.assign(lot, { shares: 0, status: 'closed', closedAt: date, closeReason: 'called' });
    event(s, { date, cycleId: p.cycleId, positionId: id, symbol: p.symbol, type: 'called_away', qty: shares, price: p.strike, strike: p.strike, cash: p.strike * shares - fee, realized: optRealized + stockRealized });
    maybeCompleteCycle(s, p.cycleId, date);
  });
}

export function sellShares(lotId, { shares, price, fee = 0, date }) {
  price = posNum(price, 'Price');
  fee = nonNeg(fee, 'Fee');
  date = validDate(date || today());
  commit((s) => {
    const lot = openPos(s, lotId);
    need(lot.kind === 'stock', 'Not a share lot');
    const free = lot.shares - coveredShares(s, lotId);
    shares = Math.round(posNum(shares ?? free, 'Shares'));
    need(shares <= free, `Only ${free} uncovered shares available — close covered calls first`);
    const realized = (price - lot.cost) * shares - fee;
    lot.shares -= shares;
    lot.realized = r2((lot.realized || 0) + realized);
    if (lot.shares <= 0) Object.assign(lot, { shares: 0, status: 'closed', closedAt: date, closeReason: 'sold' });
    event(s, { date, cycleId: lot.cycleId, positionId: lotId, symbol: lot.symbol, type: 'sell_shares', qty: shares, price, cash: price * shares - fee, realized });
    maybeCompleteCycle(s, lot.cycleId, date);
  });
}

// Roll = buy to close + sell a new contract in the same cycle, as one undoable step.
export function rollOption(id, { closePrice, strike, expiration, premium, fee = 0, date }) {
  closePrice = nonNeg(closePrice, 'Buy-back price');
  strike = posNum(strike, 'New strike');
  premium = posNum(premium, 'New premium');
  fee = nonNeg(fee, 'Fee');
  validDate(expiration);
  date = validDate(date || today());
  need(expiration >= date, 'New expiration must be on or after the trade date');
  commit((s) => {
    const p = openPos(s, id);
    need(p.kind === 'csp' || p.kind === 'cc', 'Not an option position');
    const debit = closePrice * 100 * p.contracts + fee * p.contracts;
    const realized = p.premium * 100 * p.contracts - p.openFee - debit;
    Object.assign(p, { status: 'closed', closedAt: date, closeReason: 'rolled', closePrice, realized: r2(realized) });
    event(s, { date, cycleId: p.cycleId, positionId: id, symbol: p.symbol, type: 'btc', kind: p.kind, qty: p.contracts, price: closePrice, strike: p.strike, cash: -debit, realized, note: 'Roll — close leg' });
    const nid = uid();
    s.positions.push({ ...p, id: nid, strike, expiration, premium, openFee: r2(fee * p.contracts), openedAt: date, status: 'open', closedAt: null, closeReason: null, closePrice: null, realized: null, rolledFrom: id });
    event(s, { date, cycleId: p.cycleId, positionId: nid, symbol: p.symbol, type: p.kind === 'csp' ? 'sell_put' : 'sell_call', qty: p.contracts, price: premium, strike, expiration, cash: premium * 100 * p.contracts - fee * p.contracts, note: 'Roll — open leg' });
  });
}

// ---------- derived figures ----------

const PREMIUM_TYPES = new Set(['sell_put', 'sell_call']);
const startOfWeek = (d) => {
  const x = new Date(d + 'T00:00:00');
  const day = (x.getDay() + 6) % 7; // Monday
  x.setDate(x.getDate() - day);
  return x.toLocaleDateString('en-CA');
};

// Net option premium per event: sells add, buy-to-close debits subtract.
const netPremium = (e) => (PREMIUM_TYPES.has(e.type) ? e.cash : e.type === 'btc' ? e.cash : 0);

export function summary(s = state) {
  const t = today();
  const week = startOfWeek(t);
  const month = t.slice(0, 7);
  const year = t.slice(0, 4);
  const sum = (pred, f) => s.journal.filter(pred).reduce((a, e) => a + f(e), 0);

  const cashFlow = sum(() => true, (e) => e.cash);
  const cash = s.settings.capital + cashFlow;
  const openPuts = s.positions.filter((p) => p.kind === 'csp' && p.status === 'open');
  const openCalls = s.positions.filter((p) => p.kind === 'cc' && p.status === 'open');
  const lots = s.positions.filter((p) => p.kind === 'stock' && p.status === 'open');
  const reserved = openPuts.reduce((a, p) => a + p.strike * 100 * p.contracts, 0);
  const stockAtCost = lots.reduce((a, p) => a + p.cost * p.shares, 0);

  return {
    cash: r2(cash),
    reserved: r2(reserved),
    available: r2(cash - reserved),
    stockAtCost: r2(stockAtCost),
    premiumWeek: r2(sum((e) => e.date >= week, netPremium)),
    premiumMonth: r2(sum((e) => e.date.startsWith(month), netPremium)),
    premiumYear: r2(sum((e) => e.date.startsWith(year), netPremium)),
    premiumAll: r2(sum(() => true, netPremium)),
    realizedYear: r2(sum((e) => e.date.startsWith(year), (e) => e.realized)),
    realizedAll: r2(sum(() => true, (e) => e.realized)),
    openPremium: r2([...openPuts, ...openCalls].reduce((a, p) => a + p.premium * 100 * p.contracts, 0)),
    activeTrades: openPuts.length + openCalls.length + lots.length,
    openPuts,
    openCalls,
    lots,
    activeCycles: s.cycles.filter((c) => c.status === 'active'),
    completedCycles: s.cycles.filter((c) => c.status === 'completed'),
  };
}

export function cycleStats(cycleId, s = state) {
  const events = s.journal.filter((e) => e.cycleId === cycleId);
  const positions = s.positions.filter((p) => p.cycleId === cycleId);
  const premium = events.reduce((a, e) => a + netPremium(e), 0);
  const realized = events.reduce((a, e) => a + e.realized, 0);
  const lot = positions.find((p) => p.kind === 'stock' && p.status === 'open');
  const peakCapital = Math.max(0, ...positions.map((p) => (p.kind === 'csp' ? p.strike * 100 * p.contracts : p.kind === 'stock' ? p.cost * (p.shares || 0) + 0 : 0)), ...events.filter((e) => e.type === 'assigned' || e.type === 'buy_shares').map((e) => -e.cash));
  return {
    events,
    positions,
    premium: r2(premium),
    realized: r2(realized),
    lot,
    adjustedBasis: lot ? r2(lot.cost - premium / lot.shares) : null,
    peakCapital: r2(peakCapital),
    stage: stageOf(positions),
  };
}

// Stage index on the 5-step wheel: 0 put open, 1 assigned, 2 holding shares, 3 call open, 4 called away/complete.
export function stageOf(positions) {
  const open = positions.filter((p) => p.status === 'open');
  if (!open.length) return 4;
  if (open.some((p) => p.kind === 'cc')) return 3;
  if (open.some((p) => p.kind === 'stock')) return positions.some((p) => p.kind === 'cc') ? 2 : positions.some((p) => p.closeReason === 'assigned') ? 1 : 2;
  return 0;
}

export function monthlyPremium(months = 12, s = state) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = months - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    const key = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: x.toLocaleDateString('en-US', { month: 'short' }), premium: 0, realized: 0 });
  }
  const idx = Object.fromEntries(out.map((m, i) => [m.key, i]));
  for (const e of s.journal) {
    const i = idx[e.date.slice(0, 7)];
    if (i == null) continue;
    out[i].premium += netPremium(e);
    out[i].realized += e.realized;
  }
  return out.map((m) => ({ ...m, premium: r2(m.premium), realized: r2(m.realized) }));
}

// Buy shares and sell a covered call against them as one undoable step.
export function buyWrite({ symbol, contracts, price, strike, expiration, premium, fee, date, source }) {
  symbol = String(symbol || '').toUpperCase().trim();
  need(/^[A-Z]{1,5}(\.[A-Z])?$/.test(symbol), 'Enter a valid ticker');
  contracts = Math.round(posNum(contracts, 'Contracts'));
  price = posNum(price, 'Share price');
  strike = posNum(strike, 'Strike');
  premium = posNum(premium, 'Premium');
  fee = nonNeg(fee, 'Fee');
  validDate(expiration);
  date = validDate(date || today());
  need(expiration >= date, 'Expiration must be on or after the trade date');
  const shares = contracts * 100;
  commit((s) => {
    const cycleId = uid();
    s.cycles.push({ id: cycleId, symbol, status: 'active', openedAt: date, closedAt: null, start: 'shares' });
    const lotId = uid();
    s.positions.push({ id: lotId, cycleId, kind: 'stock', symbol, shares, cost: price, openedAt: date, status: 'open' });
    event(s, { date, cycleId, positionId: lotId, symbol, type: 'buy_shares', qty: shares, price, cash: -price * shares, note: 'Buy-write' });
    const id = uid();
    s.positions.push({ id, cycleId, kind: 'cc', lotId, symbol, strike, expiration, contracts, premium, openFee: r2(fee * contracts), openedAt: date, status: 'open', source: source || null });
    event(s, { date, cycleId, positionId: id, symbol, type: 'sell_call', qty: contracts, price: premium, strike, expiration, cash: premium * 100 * contracts - fee * contracts, note: 'Buy-write' });
  });
}
