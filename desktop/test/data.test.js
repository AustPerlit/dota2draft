const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const data = require('../src/data');

function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, opts });
    const body = handler(url, opts);
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return calls;
}

// Skip the rate-limit pauses in tests.
const realSetTimeout = global.setTimeout;
test.before(() => {
  global.setTimeout = (fn) => realSetTimeout(fn, 0);
});
test.after(() => {
  global.setTimeout = realSetTimeout;
});

test('STRATZ responses are normalized into vs/with/lane tables', async () => {
  const calls = mockFetch((url, opts) => {
    const q = JSON.parse(opts.body).query;
    const heroStats = {};
    for (const [, alias, num] of q.matchAll(/([ml])(\d+): /g)) {
      const id = Number(num);
      if (alias === 'm') heroStats[`m${id}`] = [{ heroId: id, with: [{ heroId2: 2, matchCount: 100, winCount: 60 }], vs: [{ heroId2: 2, matchCount: 200, winCount: 90 }] }];
      else heroStats[`l${id}`] = [{ heroId1: id, heroId2: 2, matchCount: 50, winCount: 30, drawCount: 5, lossCount: 15 }];
    }
    return { data: { heroStats } };
  });
  const d = await data.fromStratz({ token: 't', bracket: 'LEGEND_ANCIENT', onProgress() {} });
  assert.strictEqual(d.source, 'stratz');
  assert.deepStrictEqual(d.vs[1][2], { games: 200, wins: 90 });
  assert.deepStrictEqual(d.with[1][2], { games: 100, wins: 60 });
  assert.deepStrictEqual(d.lane[1][2], { games: 50, wins: 30, losses: 15 });
  assert.match(JSON.parse(calls[0].opts.body).query, /bracketBasicIds: \[LEGEND_ANCIENT\]/);
  assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer t');
});

test('STRATZ failure falls back to OpenDota and is cached', async () => {
  mockFetch((url) => {
    if (url.includes('stratz')) return { errors: [{ message: 'bad token' }] };
    if (url.endsWith('/heroStats')) return [{ id: 1, name: 'npc_dota_hero_antimage', localized_name: 'Anti-Mage', primary_attr: 'agi', roles: ['Carry'], img: '/a.png?', icon: '/a_i.png?', '1_pick': 100, '1_win': 52 }];
    if (url.includes('/matchups')) return [{ hero_id: 2, games_played: 40, wins: 25 }];
    throw new Error('unexpected ' + url);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2'));
  const d = await data.refresh({ dir, bracket: 'ALL', token: 'bad' });
  assert.strictEqual(d.source, 'opendota');
  assert.match(d.warning, /bad token/);
  assert.strictEqual(d.heroes[1].winrate, 0.52);
  assert.deepStrictEqual(d.vs[1][2], { games: 40, wins: 25 });
  assert.strictEqual(d.with, null);
  assert.strictEqual(data.readCache(dir, 'ALL').source, 'opendota');
  assert.strictEqual(data.isStale(data.readCache(dir, 'ALL')), false);
});
