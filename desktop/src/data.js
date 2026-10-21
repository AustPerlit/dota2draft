// Loads hero statistics from STRATZ (needs a free token) or OpenDota (no key)
// and normalizes them into the dataset shape documented in src/scoring.js.
const fs = require('fs');
const path = require('path');

const OPENDOTA = 'https://api.opendota.com/api';
const STRATZ = 'https://api.stratz.com/graphql';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Rank brackets as STRATZ names them. OpenDota data is not split by rank.
const BRACKETS = {
  ALL: { label: 'Все ранги', stratz: null },
  HERALD_GUARDIAN: { label: 'Herald–Guardian', stratz: 'HERALD_GUARDIAN' },
  CRUSADER_ARCHON: { label: 'Crusader–Archon', stratz: 'CRUSADER_ARCHON' },
  LEGEND_ANCIENT: { label: 'Legend–Ancient', stratz: 'LEGEND_ANCIENT' },
  DIVINE_IMMORTAL: { label: 'Divine–Immortal', stratz: 'DIVINE_IMMORTAL' },
};

const bundledHeroes = require('../data/heroes.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, options = {}, retries = 4) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, options);
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    const body = await res.text().catch(() => '');
    throw new Error(`${url.split('?')[0]} → HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}

function heroMap(list) {
  const out = {};
  for (const h of list) out[h.id] = { ...h };
  return out;
}

function put(table, a, b, value) {
  (table[a] || (table[a] = {}))[b] = value;
}

// ---------- OpenDota: counters only, no rank split ----------

async function fromOpenDota({ onProgress }) {
  const stats = await request(`${OPENDOTA}/heroStats`);
  const heroes = heroMap(bundledHeroes);
  for (const s of stats) {
    let picks = 0;
    let wins = 0;
    for (let b = 1; b <= 8; b++) {
      picks += s[`${b}_pick`] || 0;
      wins += s[`${b}_win`] || 0;
    }
    heroes[s.id] = {
      ...(heroes[s.id] || {}),
      id: s.id,
      name: s.name.replace('npc_dota_hero_', ''),
      localized: s.localized_name,
      attr: s.primary_attr,
      roles: s.roles,
      img: s.img.replace(/\?$/, ''),
      icon: s.icon.replace(/\?$/, ''),
      winrate: picks ? wins / picks : undefined,
    };
  }
  const ids = Object.keys(heroes).map(Number);
  const vs = {};
  // Free tier allows 60 requests per minute.
  for (let i = 0; i < ids.length; i++) {
    onProgress(`OpenDota: матчапы ${i + 1}/${ids.length}`);
    const rows = await request(`${OPENDOTA}/heroes/${ids[i]}/matchups`);
    for (const r of rows) put(vs, ids[i], r.hero_id, { games: r.games_played, wins: r.wins });
    await sleep(1100);
  }
  return { source: 'opendota', heroes, vs, with: null, lane: null, minGames: 15 };
}

// ---------- STRATZ: counters, team synergy and lane outcomes ----------

async function stratzQuery(token, query) {
  const json = await request(STRATZ, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'STRATZ_API',
    },
    body: JSON.stringify({ query }),
  });
  if (json.errors && json.errors.length) throw new Error(`STRATZ: ${json.errors[0].message}`);
  return json.data;
}

async function fromStratz({ token, bracket, onProgress }) {
  const heroes = heroMap(bundledHeroes);
  const ids = Object.keys(heroes).map(Number);
  const br = BRACKETS[bracket] && BRACKETS[bracket].stratz;
  const brArg = br ? `, bracketBasicIds: [${br}]` : '';
  const vs = {};
  const withT = {};
  const lane = {};
  const CHUNK = 8;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    onProgress(`STRATZ: синергия и контрпики ${Math.min(i + CHUNK, ids.length)}/${ids.length}`);
    const fields = chunk
      .map(
        (id) => `m${id}: matchUp(heroId: ${id}, take: 200${brArg}) {
          heroId
          with { heroId2 matchCount winCount }
          vs { heroId2 matchCount winCount }
        }`
      )
      .join('\n');
    const data = await stratzQuery(token, `{ heroStats { ${fields} } }`);
    for (const id of chunk) {
      const entry = (data.heroStats[`m${id}`] || [])[0];
      if (!entry) continue;
      for (const r of entry.with || []) put(withT, id, r.heroId2, { games: r.matchCount, wins: r.winCount });
      for (const r of entry.vs || []) put(vs, id, r.heroId2, { games: r.matchCount, wins: r.winCount });
    }
    await sleep(400);
  }

  // Lane outcomes are optional: if the query is rejected, keep the rest.
  let laneError = null;
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      onProgress(`STRATZ: линии ${Math.min(i + CHUNK, ids.length)}/${ids.length}`);
      const fields = chunk
        .map(
          (id) => `l${id}: laneOutcome(heroId: ${id}, isWith: true${brArg}) {
            heroId1 heroId2 matchCount winCount drawCount lossCount
          }`
        )
        .join('\n');
      const data = await stratzQuery(token, `{ heroStats { ${fields} } }`);
      for (const id of chunk) {
        for (const r of data.heroStats[`l${id}`] || []) {
          const other = r.heroId1 === id ? r.heroId2 : r.heroId1;
          put(lane, id, other, { games: r.matchCount, wins: r.winCount, losses: r.lossCount });
        }
      }
      await sleep(400);
    }
  } catch (e) {
    laneError = e.message;
  }

  return {
    source: 'stratz',
    heroes,
    vs,
    with: withT,
    lane: laneError ? null : lane,
    minGames: 100,
    warning: laneError ? `Данные по линиям недоступны: ${laneError}` : undefined,
  };
}

// ---------- cache ----------

function cacheFile(dir, bracket) {
  return path.join(dir, `stats-${bracket}.json`);
}

function readCache(dir, bracket) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(dir, bracket), 'utf8'));
  } catch {
    return null;
  }
}

function isStale(dataset) {
  return !dataset || Date.now() - dataset.updatedAt > MAX_AGE_MS;
}

// Fetches fresh data, preferring STRATZ when a token is set and falling back
// to OpenDota if STRATZ fails. Writes the result to the cache.
async function refresh({ dir, bracket = 'ALL', token = '', onProgress = () => {} }) {
  let dataset;
  let warning;
  if (token) {
    try {
      dataset = await fromStratz({ token, bracket, onProgress });
    } catch (e) {
      warning = `STRATZ не ответил (${e.message}), использую OpenDota: только контрпики.`;
    }
  }
  if (!dataset) dataset = await fromOpenDota({ onProgress });
  dataset.bracket = token && dataset.source === 'stratz' ? bracket : 'ALL';
  dataset.updatedAt = Date.now();
  if (warning) dataset.warning = warning;
  else if (!token) dataset.warning = 'Без токена STRATZ доступны только контрпики (OpenDota). Добавьте токен в настройках.';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(cacheFile(dir, bracket), JSON.stringify(dataset));
  return dataset;
}

module.exports = { BRACKETS, bundledHeroes, readCache, isStale, refresh, fromOpenDota, fromStratz };
