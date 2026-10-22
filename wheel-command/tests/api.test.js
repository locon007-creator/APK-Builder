import { test } from 'node:test';
import assert from 'node:assert/strict';
import './mock-upstream.js';
import { GET as analyze } from '../api/analyze.js';
import { GET as health } from '../api/health.js';
import { GET as universe } from '../api/universe.js';

const call = async (handler, qs) => {
  const res = await handler(new Request(`http://localhost/api/x?${qs}`));
  return { status: res.status, body: await res.json() };
};

test('universe lists markets', async () => {
  const { body } = await call(universe, '');
  assert.deepEqual(body.markets.map((m) => m.key), ['sp100', 'ndx100', 'nyse100', 'dow30']);
  assert.equal((await call(universe, 'market=dow30')).body.symbols.length, 30);
});

test('analyze returns a scored opportunity with tiers', async () => {
  const { status, body } = await call(analyze, 'symbol=MSFT&strategy=both&capital=100000');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.ok(body.score >= 0 && body.score <= 100);
  const st = body.strategies[body.primary];
  assert.ok(st.tiers[st.selected].premium > 0);
  assert.ok(['Strong Candidate', 'Favorable', 'Watch', 'Avoid'].includes(body.verdict));
});

test('analyze marks options-unentitled and quote-less symbols Unverified', async () => {
  assert.equal((await call(analyze, 'symbol=MMM')).body.status, 'unverified');
  const ko = (await call(analyze, 'symbol=KO')).body;
  assert.equal(ko.status, 'unverified');
  assert.equal(ko.score, null);
});

test('analyze validates input', async () => {
  assert.equal((await call(analyze, 'symbol=../etc')).status, 400);
  assert.equal((await call(analyze, 'symbol=AAPL&strategy=x')).status, 400);
});

test('health reports entitlements without exposing the key', async () => {
  const { body } = await call(health, '');
  assert.equal(body.configured, true);
  assert.equal(body.entitlements.options, 'ok');
  assert.ok(!JSON.stringify(body).includes(process.env.MASSIVE_API_KEY));
});
