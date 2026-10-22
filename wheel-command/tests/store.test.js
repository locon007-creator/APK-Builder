import { test } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const S = await import('../public/store.js');

test('full wheel cycle: put → assigned → call → called away', () => {
  S.resetAll();
  S.updateSettings({ capital: 20000 });
  S.sellPut({ symbol: 'abc', strike: 50, expiration: '2099-01-17', contracts: 2, premium: 1.0, fee: 0.5, date: '2026-01-05' });
  let sum = S.summary();
  assert.equal(sum.reserved, 10000);
  assert.equal(sum.cash, 20000 + 200 - 1);
  const put = sum.openPuts[0];
  S.assignPut(put.id, { date: '2026-01-20' });
  sum = S.summary();
  assert.equal(sum.lots[0].shares, 200);
  assert.equal(sum.reserved, 0);
  assert.equal(sum.cash, 20199 - 10000);
  const lot = sum.lots[0];
  const cs = S.cycleStats(lot.cycleId);
  assert.equal(cs.adjustedBasis, 49.01);
  assert.throws(() => S.sellCall({ lotId: lot.id, strike: 52, expiration: '2099-02-21', contracts: 3, premium: 0.8, fee: 0, date: '2026-01-21' }), /contract/);
  S.sellCall({ lotId: lot.id, strike: 52, expiration: '2099-02-21', contracts: 2, premium: 0.8, fee: 0, date: '2026-01-21' });
  const cc = S.summary().openCalls[0];
  S.callAway(cc.id, { date: '2026-02-21' });
  sum = S.summary();
  assert.equal(sum.lots.length, 0);
  assert.equal(sum.completedCycles.length, 1);
  // realized: put 199 + call 160 + stock (52-50)*200 = 759
  assert.equal(S.summary().realizedAll, 759);
  assert.equal(sum.cash, 20000 + 759);
});

test('buy to close, roll and undo', () => {
  S.resetAll();
  S.sellPut({ symbol: 'XYZ', strike: 100, expiration: '2099-01-17', contracts: 1, premium: 2, fee: 0, date: '2026-03-02' });
  const p = S.summary().openPuts[0];
  S.rollOption(p.id, { closePrice: 1, strike: 95, expiration: '2099-02-21', premium: 1.8, fee: 0, date: '2026-03-10' });
  const after = S.summary();
  assert.equal(after.openPuts.length, 1);
  assert.equal(after.openPuts[0].strike, 95);
  assert.equal(after.realizedAll, 100);
  assert.ok(S.canUndo());
  S.undo();
  assert.equal(S.summary().openPuts[0].strike, 100);
  S.closeOption(p.id, { how: 'btc', price: 0.5, fee: 0, date: '2026-03-12' });
  assert.equal(S.summary().realizedAll, 150);
  assert.equal(S.summary().completedCycles.length, 1);
});

test('buy-write and share sale', () => {
  S.resetAll();
  S.buyWrite({ symbol: 'QQQ', contracts: 1, price: 400, strike: 420, expiration: '2099-01-17', premium: 5, fee: 0, date: '2026-04-01' });
  const s = S.summary();
  assert.equal(s.lots[0].shares, 100);
  assert.equal(s.openCalls.length, 1);
  assert.throws(() => S.sellShares(s.lots[0].id, { shares: 100, price: 410, date: '2026-04-02' }), /uncovered/);
  S.closeOption(s.openCalls[0].id, { how: 'expired', date: '2026-04-20' });
  S.sellShares(s.lots[0].id, { shares: 100, price: 410, fee: 0, date: '2026-04-21' });
  assert.equal(S.summary().realizedAll, 500 + 1000);
  assert.equal(S.summary().completedCycles.length, 1);
});

test('input validation', () => {
  assert.throws(() => S.sellPut({ symbol: '', strike: 1, expiration: '2099-01-01', contracts: 1, premium: 1 }), /ticker/);
  assert.throws(() => S.sellPut({ symbol: 'A', strike: -1, expiration: '2099-01-01', contracts: 1, premium: 1 }), /Strike/);
  assert.throws(() => S.importState({ foo: 1 }), /export/);
});
