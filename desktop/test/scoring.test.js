const test = require('node:test');
const assert = require('node:assert');
const S = require('../src/scoring');
const { dataset } = require('./fixtures');

test('advantage is positive for the counter and negative the other way', () => {
  const d = dataset();
  assert.ok(S.advantage(d, 1, 2).value > 0.05);
  assert.ok(S.advantage(d, 2, 1).value < -0.05);
  assert.ok(Math.abs(S.advantage(d, 3, 4).value) < 0.01);
});

test('small samples are shrunk toward zero', () => {
  const d = dataset();
  d.vs[1][2] = { games: 10, wins: 9 };
  d.vs[2][1] = { games: 10, wins: 1 };
  assert.ok(S.advantage(d, 1, 2).value < 0.05);
  assert.strictEqual(S.advantage(d, 1, 2, 50), null);
});

test('hero profile lists the four relations', () => {
  const d = dataset();
  assert.deepStrictEqual(S.heroProfile(d, 1).counters.map((x) => x.id), [2]);
  assert.deepStrictEqual(S.heroProfile(d, 2).counteredBy.map((x) => x.id), [1]);
  assert.strictEqual(S.heroProfile(d, 3).teammates[0].id, 4);
  assert.strictEqual(S.heroProfile(d, 5).lanePartners[0].id, 6);
});

test('pick suggestions combine counters and synergy', () => {
  const d = dataset();
  const picks = S.suggestPicks(d, { allies: [4], enemies: [2] });
  const ids = picks.map((p) => p.id);
  assert.ok(!ids.includes(4) && !ids.includes(2));
  assert.deepStrictEqual(ids.slice(0, 2).sort(), [1, 3]);
  assert.ok(picks[0].score > 0.05);
});

test('ban suggestions find heroes that beat our picks', () => {
  const d = dataset();
  assert.strictEqual(S.suggestBans(d, { allies: [2], enemies: [] })[0].id, 1);
});

test('role filter keeps only matching heroes', () => {
  const d = dataset();
  const picks = S.suggestPicks(d, { enemies: [2], role: 'Support' });
  assert.ok(picks.every((p) => d.heroes[p.id].roles.includes('Support')));
});

test('missing tables do not break the profile', () => {
  const d = dataset();
  d.with = null;
  d.lane = null;
  const p = S.heroProfile(d, 1);
  assert.deepStrictEqual(p.teammates, []);
  assert.deepStrictEqual(p.lanePartners, []);
});

test('pair report describes both directions and teamwork', () => {
  const d = dataset();
  const r = S.pairReport(d, 1, 2);
  assert.ok(r.versus.value > 0.05);
  assert.strictEqual(r.versusRaw.winrate, 0.6);
  assert.ok(S.pairReport(d, 2, 1).versus.value < -0.05);
  assert.strictEqual(S.pairReport(d, 2, 1).versusRaw.winrate, 0.4);
  assert.ok(S.pairReport(d, 3, 4).together.value > 0.05);
  assert.ok(S.pairReport(d, 5, 6).lane.value > 0.05);
  d.with = null;
  assert.strictEqual(S.pairReport(d, 3, 4).together, null);
});
