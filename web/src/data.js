// Browser data layer. Uses statistics embedded in the page when present
// (window.EMBEDDED_STATS), otherwise loads them live from STRATZ (with a
// token) or OpenDota and caches them in localStorage for a day.
(function (root) {
  const OPENDOTA = 'https://api.opendota.com/api';
  const STRATZ = 'https://api.stratz.com/graphql';
  const MAX_AGE_MS = 24 * 60 * 60 * 1000;

  const BRACKETS = {
    ALL: { label: 'Все ранги', stratz: null },
    HERALD_GUARDIAN: { label: 'Herald–Guardian', stratz: 'HERALD_GUARDIAN' },
    CRUSADER_ARCHON: { label: 'Crusader–Archon', stratz: 'CRUSADER_ARCHON' },
    LEGEND_ANCIENT: { label: 'Legend–Ancient', stratz: 'LEGEND_ANCIENT' },
    DIVINE_IMMORTAL: { label: 'Divine–Immortal', stratz: 'DIVINE_IMMORTAL' },
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const store = {
    get(key) {
      try {
        return JSON.parse(localStorage.getItem(key));
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Storage full or blocked: the data still works for this visit.
      }
    },
  };

  async function request(url, options = {}, retries = 4) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, options);
      if (res.ok) return res.json();
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      throw new Error(`${url.split('?')[0]} → HTTP ${res.status}`);
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

  async function fromOpenDota(heroList, onProgress) {
    const stats = await request(`${OPENDOTA}/heroStats`);
    const heroes = heroMap(heroList);
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
        roles: s.roles,
        img: s.img.replace(/\?$/, ''),
        icon: s.icon.replace(/\?$/, ''),
        winrate: picks ? wins / picks : undefined,
      };
    }
    const ids = Object.keys(heroes).map(Number);
    const vs = {};
    for (let i = 0; i < ids.length; i++) {
      onProgress(`OpenDota: матчапы ${i + 1}/${ids.length}`);
      const rows = await request(`${OPENDOTA}/heroes/${ids[i]}/matchups`);
      for (const r of rows) put(vs, ids[i], r.hero_id, { games: r.games_played, wins: r.wins });
      await sleep(1100);
    }
    return { source: 'opendota', heroes, vs, with: null, lane: null, minGames: 15 };
  }

  async function stratzQuery(token, query) {
    const json = await request(STRATZ, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query }),
    });
    if (json.errors && json.errors.length) throw new Error(`STRATZ: ${json.errors[0].message}`);
    return json.data;
  }

  async function fromStratz(heroList, token, bracket, onProgress) {
    const heroes = heroMap(heroList);
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
        .map((id) => `m${id}: matchUp(heroId: ${id}, take: 200${brArg}) { heroId with { heroId2 matchCount winCount } vs { heroId2 matchCount winCount } }`)
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

    let laneError = null;
    try {
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        onProgress(`STRATZ: линии ${Math.min(i + CHUNK, ids.length)}/${ids.length}`);
        const fields = chunk
          .map((id) => `l${id}: laneOutcome(heroId: ${id}, isWith: true${brArg}) { heroId1 heroId2 matchCount winCount drawCount lossCount }`)
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

  const cacheKey = (bracket) => `d2draft-stats-${bracket}`;

  function embedded() {
    return root.EMBEDDED_STATS || null;
  }

  function cached(bracket) {
    if (embedded()) return { dataset: embedded(), stale: false };
    const d = store.get(cacheKey(bracket));
    return { dataset: d, stale: !d || Date.now() - d.updatedAt > MAX_AGE_MS };
  }

  async function refresh(heroList, { bracket = 'ALL', token = '', onProgress = () => {} }) {
    let dataset;
    let warning;
    if (token) {
      try {
        dataset = await fromStratz(heroList, token, bracket, onProgress);
      } catch (e) {
        warning = `STRATZ не ответил (${e.message}), использую OpenDota: только контрпики.`;
      }
    }
    if (!dataset) dataset = await fromOpenDota(heroList, onProgress);
    dataset.bracket = dataset.source === 'stratz' ? bracket : 'ALL';
    dataset.updatedAt = Date.now();
    if (warning) dataset.warning = warning;
    else if (!token) dataset.warning = 'Без токена STRATZ доступны только контрпики (OpenDota). Добавьте токен в настройках.';
    store.set(cacheKey(bracket), dataset);
    return dataset;
  }

  root.DraftData = { BRACKETS, cached, refresh, embedded, store };
})(window);
