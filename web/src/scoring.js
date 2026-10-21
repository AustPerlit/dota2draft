// Draft scoring logic. Pure functions, shared by the renderer (window.Scoring)
// and the Node tests (module.exports).
//
// Dataset shape (see src/data.js):
//   heroes: { [id]: { id, name, localized, roles, img, icon, winrate? } }
//   vs:     { [a]: { [b]: { games, wins } } }          a's results against b
//   with:   { [a]: { [b]: { games, wins } } }          a's results with teammate b
//   lane:   { [a]: { [b]: { games, wins, losses } } }  lane outcome of a with b on the same lane
(function (root) {
  // Prior weight for shrinking small samples toward zero.
  const SHRINK = 150;

  const clamp = (p) => Math.min(0.99, Math.max(0.01, p));
  const logit = (p) => Math.log(clamp(p) / (1 - clamp(p)));
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const shrink = (delta, games) => (delta * games) / (games + SHRINK);

  const baseCache = new WeakMap();

  // Overall win rate of a hero. Uses the provider's value when present,
  // otherwise derives it from the vs table.
  function baseWinrate(data, id) {
    const h = data.heroes[id];
    if (h && typeof h.winrate === 'number') return h.winrate;
    let cache = baseCache.get(data);
    if (!cache) baseCache.set(data, (cache = {}));
    if (cache[id] === undefined) {
      let games = 0;
      let wins = 0;
      for (const r of Object.values((data.vs && data.vs[id]) || {})) {
        games += r.games;
        wins += r.wins;
      }
      cache[id] = games ? wins / games : 0.5;
    }
    return cache[id];
  }

  function rec(table, a, b) {
    const r = table && table[a] && table[a][b];
    return r && r.games > 0 ? r : null;
  }

  // How much better a does against b than the two base win rates predict.
  // Positive: a counters b. Uses both directions of the table when available.
  function advantage(data, a, b, minGames = 0) {
    const ab = rec(data.vs, a, b);
    const ba = rec(data.vs, b, a);
    const expected = sigmoid(logit(baseWinrate(data, a)) - logit(baseWinrate(data, b)));
    const parts = [];
    if (ab && ab.games >= minGames) parts.push({ d: ab.wins / ab.games - expected, g: ab.games });
    if (ba && ba.games >= minGames) parts.push({ d: 1 - ba.wins / ba.games - expected, g: ba.games });
    if (!parts.length) return null;
    const games = Math.max(...parts.map((p) => p.g));
    const delta = parts.reduce((s, p) => s + p.d * p.g, 0) / parts.reduce((s, p) => s + p.g, 0);
    return { value: shrink(delta, games), delta, games };
  }

  // How much better a and b do together than their base win rates predict.
  function synergy(data, a, b, minGames = 0) {
    const r = rec(data.with, a, b) || rec(data.with, b, a);
    if (!r || r.games < minGames) return null;
    const expected = sigmoid(logit(baseWinrate(data, a)) + logit(baseWinrate(data, b)));
    const delta = r.wins / r.games - expected;
    return { value: shrink(delta, r.games), delta, games: r.games };
  }

  // Lane outcome of a and b sharing a lane: (won - lost) / games, halved to
  // sit on the same scale as a win-rate delta.
  function laneSynergy(data, a, b, minGames = 0) {
    const r = rec(data.lane, a, b) || rec(data.lane, b, a);
    if (!r || r.games < minGames) return null;
    const delta = (r.wins - (r.losses || 0)) / r.games / 2;
    return { value: shrink(delta, r.games), delta, games: r.games };
  }

  function topBy(ids, fn, limit, sign) {
    const out = [];
    for (const id of ids) {
      const s = fn(id);
      if (s && s.value * sign > 0) out.push({ id: Number(id), ...s });
    }
    out.sort((x, y) => (y.value - x.value) * sign);
    return out.slice(0, limit);
  }

  // The four lists shown on a hero card.
  function heroProfile(data, id, { limit = 10, minGames = 0 } = {}) {
    const others = Object.keys(data.heroes).map(Number).filter((x) => x !== Number(id));
    return {
      lanePartners: data.lane ? topBy(others, (o) => laneSynergy(data, id, o, minGames), limit, 1) : [],
      teammates: data.with ? topBy(others, (o) => synergy(data, id, o, minGames), limit, 1) : [],
      counters: topBy(others, (o) => advantage(data, id, o, minGames), limit, 1),
      counteredBy: topBy(others, (o) => advantage(data, o, id, minGames), limit, 1),
    };
  }

  function sumParts(list) {
    return list.reduce((s, p) => s + p.value, 0);
  }

  // Rank heroes still available for a pick.
  // score = sum of advantage vs each enemy + sum of synergy with each ally.
  function suggestPicks(data, { allies = [], enemies = [], bans = [], limit = 15, minGames = 0, role = '' } = {}) {
    const taken = new Set([...allies, ...enemies, ...bans].map(Number));
    const out = [];
    for (const key of Object.keys(data.heroes)) {
      const c = Number(key);
      if (taken.has(c)) continue;
      if (role && !(data.heroes[c].roles || []).includes(role)) continue;
      const vs = enemies.map((e) => ({ id: Number(e), ...(advantage(data, c, e, minGames) || { value: 0, games: 0 }) }));
      const wi = allies.map((a) => ({ id: Number(a), ...(synergy(data, c, a, minGames) || { value: 0, games: 0 }) }));
      out.push({ id: c, score: sumParts(vs) + sumParts(wi), vs, with: wi });
    }
    out.sort((x, y) => y.score - x.score);
    return out.slice(0, limit);
  }

  // Rank heroes worth banning: strongest against our picks and best with theirs.
  function suggestBans(data, { allies = [], enemies = [], bans = [], limit = 10, minGames = 0 } = {}) {
    return suggestPicks(data, { allies: enemies, enemies: allies, bans, limit, minGames });
  }

  const api = { baseWinrate, advantage, synergy, laneSynergy, heroProfile, suggestPicks, suggestBans, SHRINK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoring = api;
})(typeof window !== 'undefined' ? window : globalThis);
