/* global Scoring, DraftData, state, $, el, imgUrl, heroName, pct, minGames, ATTRIBUTES */
// Draft challenge mini-game. Twelve random bans, then an ally picks at random
// (or the player, if that option is off), the player fills the other slots and
// the opponent picks at the same time: blind meta picks first, then counters to
// the player's heroes from earlier phases, covering the five standard positions. In the
// last-pick mode both teams start with four heroes and the player picks the
// fifth. At the end both sides place their heroes on the minimap, and the draft
// and the lanes are scored from match statistics.

// Order of picks in the full draft. 'random', 'enemy' and 'preset' steps happen
// on their own, 'player' steps wait for clicks.
const FIRST_RANDOM = { side: 'allies', who: 'random', n: 1, text: 'Союзник выбирает случайного героя' };
const FIRST_PLAYER = { side: 'allies', who: 'player', n: 1, text: 'Ваш ход: выберите первого героя' };
const FULL_STEPS = [
  { side: 'allies', who: 'player', n: 1, text: 'Ваш ход: выберите героя' },
  { side: 'enemies', who: 'enemy', n: 2, sees: 0, text: 'Соперник выбирает двух героев' },
  { side: 'allies', who: 'player', n: 2, text: 'Ваш ход: выберите двух героев' },
  { side: 'enemies', who: 'enemy', n: 2, sees: 2, text: 'Соперник выбирает ещё двух героев' },
  { side: 'allies', who: 'player', n: 1, text: 'Последний ход: выберите заключительного героя' },
  { side: 'enemies', who: 'enemy', n: 1, sees: 4, text: 'Соперник делает последний выбор' },
];
const LAST_PICK_STEPS = [
  { side: 'allies', who: 'preset', n: 4, text: 'Собираем вашу команду' },
  { side: 'enemies', who: 'preset', n: 4, text: 'Собираем команду соперника' },
  { side: 'allies', who: 'player', n: 1, text: 'Ваш ластпик: выберите пятого героя' },
];
const GAME_OPTIONS_KEY = 'd2draft-game-options';
const BAN_COUNT = 12;
const GAME_RECORD_KEY = 'd2draft-game-record';
const PICK_DELAY_MS = 700;
const BAN_DELAY_MS = 120;

const POSITION_NAMES = { 1: 'Керри', 2: 'Мидер', 3: 'Оффлейнер', 4: 'Софт-саппорт', 5: 'Фул-саппорт' };
// You play Radiant: your safe lane is bottom, the opponent's (Dire) safe lane is top.
const LANES = {
  top: { label: 'Верхняя линия', mine: [3, 4], theirs: [1, 5], hint: 'ваш офлейн' },
  mid: { label: 'Мид', mine: [2], theirs: [2], hint: 'центр' },
  bot: { label: 'Нижняя линия', mine: [1, 5], theirs: [3, 4], hint: 'ваша лёгкая' },
};
const game = {
  open: false,
  mode: 'full', // full | lastpick
  randomFirst: true,
  steps: [],
  phase: 'idle', // idle | bans | draft | lanes | done
  bans: [],
  allies: [],
  enemies: [],
  enemyPos: {}, // enemy hero id -> position 1..5, shown only after the lanes
  allyPos: {}, // positions of preset allies in the last-pick mode
  lanes: {}, // ally hero id -> top | mid | bot
  enemyLanes: {},
  selected: null,
  step: -1,
  left: 0,
  busy: false,
  search: '',
  picks: [], // player picks with the best option at that moment
  enemyNotes: [], // why the opponent took each hero
  result: null,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gameTaken = () => new Set([...game.bans, ...game.allies, ...game.enemies]);
const points = (v) => Math.round(v * 1000);
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
const positionsOf = (id) => (window.HERO_POSITIONS && window.HERO_POSITIONS[id]) || [1, 2, 3, 4, 5];
const val = (r) => (r ? r.value : 0);

function freeHeroes() {
  const taken = gameTaken();
  return Object.keys(state.heroes).map(Number).filter((id) => !taken.has(id));
}

function randomFree() {
  const free = freeHeroes();
  return free[Math.floor(Math.random() * free.length)];
}

// A random hero for one of the side's still-open positions (used to set up the
// last-pick mode, where both teams already have four heroes).
function presetPick(side) {
  const used = new Set(side === 'enemies' ? Object.values(game.enemyPos) : Object.values(game.allyPos));
  const options = [];
  for (const id of freeHeroes()) {
    const pos = positionsOf(id).find((p) => !used.has(p));
    if (pos) options.push({ id, pos });
  }
  const choice = options[Math.floor(Math.random() * options.length)];
  game[side].push(choice.id);
  (side === 'enemies' ? game.enemyPos : game.allyPos)[choice.id] = choice.pos;
}

function openEnemyPositions() {
  const used = new Set(Object.values(game.enemyPos));
  return [1, 2, 3, 4, 5].filter((p) => !used.has(p));
}

// The opponent takes a hero that is strong against your picks and fits one of
// its still-open positions, picking among the top few so games differ.
// The opponent picks at the same time as the player, so it only knows the
// player's heroes from earlier phases: `sees` of them. With none known it
// takes a strong meta hero for an open position.
function enemyPick(sees) {
  const open = openEnemyPositions();
  const mg = minGames();
  const seen = game.allies.slice(0, sees);
  const options = [];
  for (const id of freeHeroes()) {
    const pos = positionsOf(id).find((p) => open.includes(p));
    if (!pos) continue;
    const counter = seen.reduce((s, a) => s + val(Scoring.advantage(state.dataset, id, a, mg)), 0);
    const team = game.enemies.reduce((s, e) => s + val(Scoring.synergy(state.dataset, id, e, mg)), 0);
    // Prefer heroes for whom the open position is their main one.
    const main = positionsOf(id)[0] === pos ? 0.005 : 0;
    const wr = state.dataset.heroes[id].winrate;
    const meta = wr ? wr - 0.5 : 0;
    options.push({ id, pos, counter, meta: wr, score: counter + team / 2 + main + meta });
  }
  options.sort((a, b) => b.score - a.score);
  const top = options.slice(0, seen.length ? 3 : 5);
  const choice = top[Math.floor(Math.random() * top.length)];
  game.enemies.push(choice.id);
  game.enemyPos[choice.id] = choice.pos;
  const best = seen
    .map((a) => ({ a, v: val(Scoring.advantage(state.dataset, choice.id, a, mg)) }))
    .sort((x, y) => y.v - x.v)[0];
  game.enemyNotes.push({
    id: choice.id,
    pos: choice.pos,
    text:
      best && best.v > 0
        ? `${heroName(choice.id)} (${POSITION_NAMES[choice.pos]}): сильнее всего против ${heroName(best.a)} (${pct(best.v)}).`
        : seen.length || !choice.meta
          ? `${heroName(choice.id)} (${POSITION_NAMES[choice.pos]}): закрывает позицию.`
          : `${heroName(choice.id)} (${POSITION_NAMES[choice.pos]}): сильный герой меты, ${pct(choice.meta - 0.5)} к винрейту, выбран вслепую.`,
  });
}

function toggleGame(open = !game.open) {
  game.open = open;
  $('.layout').classList.toggle('hidden', open);
  $('#game').classList.toggle('hidden', !open);
  $('#btn-game').textContent = open ? '← К драфту' : '🎲 Мини-игра';
  if (open) renderGame();
}

async function startGame() {
  Object.assign(game, {
    phase: 'bans',
    bans: [],
    allies: [],
    enemies: [],
    enemyPos: {},
    allyPos: {},
    lanes: {},
    enemyLanes: {},
    selected: null,
    steps: game.mode === 'lastpick' ? LAST_PICK_STEPS : [game.randomFirst ? FIRST_RANDOM : FIRST_PLAYER, ...FULL_STEPS],
    step: -1,
    left: 0,
    picks: [],
    enemyNotes: [],
    result: null,
    search: '',
    busy: true,
  });
  $('#game-search').value = '';
  renderGame();
  for (let i = 0; i < BAN_COUNT; i++) {
    await sleep(BAN_DELAY_MS);
    game.bans.push(randomFree());
    renderGame();
  }
  game.phase = 'draft';
  game.step = 0;
  await runSteps();
}

// Plays automatic steps until the player has to choose, or the draft is over.
async function runSteps() {
  game.busy = true;
  while (game.step < game.steps.length && game.steps[game.step].who !== 'player') {
    const s = game.steps[game.step];
    renderGame();
    for (let i = 0; i < s.n; i++) {
      await sleep(s.who === 'preset' ? PICK_DELAY_MS / 3 : PICK_DELAY_MS);
      if (s.who === 'enemy') enemyPick(s.sees);
      else if (s.who === 'preset') presetPick(s.side);
      else game[s.side].push(randomFree());
      renderGame();
    }
    game.step++;
  }
  game.busy = false;
  if (game.step >= game.steps.length) {
    game.phase = 'lanes';
    game.selected = game.allies[0];
  } else game.left = game.steps[game.step].n;
  renderGame();
}

function playerPick(id) {
  const s = game.steps[game.step];
  if (game.busy || !s || s.who !== 'player' || gameTaken().has(id)) return;
  // Rate the pick against what was known at that moment.
  const options = Scoring.suggestPicks(state.dataset, {
    allies: game.allies,
    enemies: game.enemies,
    bans: game.bans,
    limit: 500,
    minGames: minGames(),
  });
  const mine = options.find((o) => o.id === id);
  game.picks.push({
    id,
    score: mine ? mine.score : 0,
    best: options[0] ? options[0].id : id,
    bestScore: options[0] ? options[0].score : 0,
    rank: options.findIndex((o) => o.id === id) + 1,
    of: options.length,
  });
  game.allies.push(id);
  game.search = '';
  $('#game-search').value = '';
  game.left--;
  if (game.left > 0) {
    renderGame();
    return;
  }
  game.step++;
  runSteps();
}

// ---------- minimap ----------

function placeHero(lane) {
  if (game.phase !== 'lanes' || !game.selected) return;
  game.lanes[game.selected] = lane;
  // Move on to the next hero still without a lane.
  game.selected = game.allies.find((id) => !game.lanes[id]) || null;
  renderGame();
}

async function confirmLanes() {
  if (game.allies.some((id) => !game.lanes[id])) return;
  game.busy = true;
  game.selected = null;
  for (const id of game.enemies) {
    const pos = game.enemyPos[id];
    game.enemyLanes[id] = Object.keys(LANES).find((l) => LANES[l].theirs.includes(pos));
    await sleep(PICK_DELAY_MS / 2);
    renderGame();
  }
  game.busy = false;
  finishGame();
  renderGame();
}

function mapToken(id, side) {
  const t = el('div', `map-token ${side}`);
  t.style.backgroundImage = `url(${imgUrl(state.heroes[id])})`;
  t.title = heroName(id);
  t.append(el('span', '', heroName(id).split(' ')[0]));
  return t;
}

function minimap() {
  const wrap = el('div', 'minimap-wrap');
  const map = el('div', 'minimap');
  map.setAttribute('role', 'group');
  map.setAttribute('aria-label', 'Миникарта');
  map.append(el('div', 'map-river'), el('div', 'map-lane lane-top-h'), el('div', 'map-lane lane-top-v'));
  map.append(el('div', 'map-lane lane-bot-h'), el('div', 'map-lane lane-bot-v'), el('div', 'map-lane lane-mid'));
  map.append(el('div', 'map-base radiant'), el('div', 'map-base dire'));
  for (const [key, lane] of Object.entries(LANES)) {
    const zone = el('button', `map-zone zone-${key}`);
    zone.type = 'button';
    zone.disabled = game.phase !== 'lanes' || game.busy || !game.selected;
    zone.onclick = () => placeHero(key);
    zone.append(el('span', 'zone-label', lane.label));
    const theirs = el('div', 'zone-team');
    for (const id of game.enemies.filter((x) => game.enemyLanes[x] === key)) theirs.append(mapToken(id, 'enemy'));
    const mine = el('div', 'zone-team');
    for (const id of game.allies.filter((x) => game.lanes[x] === key)) mine.append(mapToken(id, 'ally'));
    zone.append(theirs, mine);
    map.append(zone);
  }
  wrap.append(map);

  if (game.phase === 'lanes') {
    const side = el('div', 'lane-picker');
    side.append(el('p', 'game-prompt', game.busy ? 'Соперник расставляет героев…' : 'Выберите героя, затем линию на карте.'));
    const chips = el('div', 'lane-chips');
    for (const id of game.allies) {
      const c = el('button', `lane-chip${game.selected === id ? ' selected' : ''}`);
      c.type = 'button';
      c.disabled = game.busy;
      const lane = game.lanes[id];
      c.append(el('strong', '', heroName(id)), el('span', 'muted', lane ? LANES[lane].label : 'не выставлен'));
      c.onclick = () => {
        game.selected = id;
        renderGame();
      };
      chips.append(c);
    }
    const done = el('button', 'primary', 'Готово');
    done.disabled = game.busy || game.allies.some((id) => !game.lanes[id]);
    done.onclick = confirmLanes;
    side.append(
      chips,
      el('p', 'hint', 'Обычная расстановка: керри и фул-саппорт внизу, мидер в центре, оффлейнер и софт-саппорт наверху.'),
      done
    );
    wrap.append(side);
  }
  return wrap;
}

// ---------- scoring ----------

// Draft part: every ally against every enemy, plus every pair of allies.
function scoreDraft(d, allies, enemies) {
  const mg = minGames();
  const heroes = allies.map((a) => {
    const vs = enemies.reduce((s, e) => s + val(Scoring.advantage(d, a, e, mg)), 0);
    const team = allies.filter((x) => x !== a).reduce((s, x) => s + val(Scoring.synergy(d, a, x, mg)), 0);
    return { id: a, vs, team };
  });
  let total = 0;
  for (const a of allies) for (const e of enemies) total += val(Scoring.advantage(d, a, e, mg));
  for (let i = 0; i < allies.length; i++)
    for (let j = i + 1; j < allies.length; j++) total += val(Scoring.synergy(d, allies[i], allies[j], mg));
  return { total, heroes };
}

// Lane part: heroes against the heroes on the same lane, and lane partners.
function scoreLanes(d) {
  const mg = minGames();
  return Object.entries(LANES).map(([key, lane]) => {
    const mine = game.allies.filter((id) => game.lanes[id] === key);
    const theirs = game.enemies.filter((id) => game.enemyLanes[id] === key);
    let matchup = 0;
    for (const a of mine) for (const e of theirs) matchup += val(Scoring.advantage(d, a, e, mg));
    let partners = 0;
    for (let i = 0; i < mine.length; i++)
      for (let j = i + 1; j < mine.length; j++) partners += val(Scoring.laneSynergy(d, mine[i], mine[j], mg));
    const total = matchup + partners;
    return { key, lane, mine, theirs, matchup, partners, total };
  });
}

// The opponent counter-picks, so even a solid draft often ends a little below zero.
function verdict(p) {
  if (p >= 50) return 'Отличный драфт';
  if (p >= 0) return 'Хороший драфт';
  if (p > -150) return 'Средний драфт';
  return 'Слабый драфт';
}

// Each mode keeps its own record: last-pick scores are not comparable with full drafts.
const recordKey = () => (game.mode === 'lastpick' ? `${GAME_RECORD_KEY}-lastpick` : GAME_RECORD_KEY);

function readRecord() {
  return DraftData.store.get(recordKey());
}

function finishGame() {
  const draft = scoreDraft(state.dataset, game.allies, game.enemies);
  const lanes = scoreLanes(state.dataset);
  const laneTotal = lanes.reduce((s, l) => s + l.total, 0);
  const score = points(draft.total + laneTotal);
  const record = readRecord();
  const isRecord = record === null || score > record;
  if (isRecord) DraftData.store.set(recordKey(), score);
  game.phase = 'done';
  game.result = { ...draft, lanes, laneTotal, score, record: isRecord ? score : record, isRecord };
}

// ---------- rendering ----------

function gameTeam(side, title) {
  const box = el('div', `game-team game-${side}`);
  box.append(el('h3', '', title));
  const row = el('div', 'slots');
  for (let i = 0; i < 5; i++) {
    const id = game[side][i];
    const s = el('div', 'slot');
    if (id) {
      s.classList.add('filled', 'game-slot');
      s.style.backgroundImage = `url(${imgUrl(state.heroes[id])})`;
      // The opponent's positions stay hidden until both teams are on the minimap.
      const pos = side === 'enemies' && game.phase === 'done' ? ` · ${POSITION_NAMES[game.enemyPos[id]]}` : '';
      s.append(el('span', '', heroName(id) + pos));
      s.title = heroName(id) + pos;
    }
    row.append(s);
  }
  box.append(row);
  return box;
}

function gameBans() {
  const box = el('div', 'game-bans');
  box.append(el('h3', '', `Баны (${game.bans.length}/${BAN_COUNT})`));
  const row = el('div', 'ban-row');
  for (const id of game.bans) {
    const b = el('div', 'ban-chip');
    b.style.backgroundImage = `url(${imgUrl(state.heroes[id])})`;
    b.title = heroName(id);
    b.append(el('span', '', heroName(id)));
    row.append(b);
  }
  box.append(row);
  return box;
}

function gameGrid() {
  const box = el('div', 'groups');
  const q = game.search.trim().toLowerCase();
  const taken = gameTaken();
  const list = Object.values(state.heroes)
    .filter((h) => !q || h.localized.toLowerCase().includes(q))
    .sort((a, b) => a.localized.localeCompare(b.localized));
  for (const [key, label] of ATTRIBUTES) {
    const group = list.filter((h) => h.attr === key);
    if (!group.length) continue;
    const head = el('h3', `attr-head attr-${key}`);
    head.append(el('span', 'attr-dot'), el('span', '', label));
    const grid = el('div', 'grid');
    for (const h of group) {
      const c = el('button', 'hero');
      c.type = 'button';
      c.style.backgroundImage = `url(${imgUrl(h)})`;
      c.title = `${h.localized}: ${positionsOf(h.id).map((p) => POSITION_NAMES[p]).join(', ')}`;
      c.append(el('span', '', h.localized));
      if (game.allies.includes(h.id)) c.classList.add('ally');
      else if (game.enemies.includes(h.id)) c.classList.add('enemy');
      else if (game.bans.includes(h.id)) c.classList.add('banned');
      c.disabled = taken.has(h.id) || game.busy;
      c.onclick = () => playerPick(h.id);
      grid.append(c);
    }
    box.append(head, grid);
  }
  return box;
}

function gameResults() {
  const r = game.result;
  const box = el('div', 'game-result');
  const head = el('div', 'game-score');
  head.append(
    el('div', `game-points ${r.score >= 0 ? 'pos' : 'neg'}`, `${signed(r.score)} очков`),
    el('div', '', `${verdict(r.score)} · драфт ${signed(points(r.total))}, линии ${signed(points(r.laneTotal))}`),
    el('div', 'muted', r.isRecord ? 'Новый рекорд!' : `Рекорд: ${signed(r.record)}`)
  );
  box.append(head);

  box.append(el('h4', '', 'Линии'));
  const lanes = el('ul', 'game-picks');
  for (const l of r.lanes) {
    const mine = l.mine.map(heroName).join(', ') || 'никого';
    const theirs = l.theirs.map(heroName).join(', ') || 'никого';
    const parts = [`${l.lane.label}: ${mine} против ${theirs}, ${signed(points(l.total))}`];
    if (l.partners) parts.push(`пара на линии ${pct(l.partners)}`);
    lanes.append(el('li', '', parts.join('; ') + '.'));
  }
  box.append(lanes);

  box.append(el('h4', '', 'Вклад героев вашей команды в драфт'));
  const ol = el('ol', 'list');
  for (const h of r.heroes) {
    const li = el('li');
    const img = el('img');
    img.src = imgUrl(state.heroes[h.id]);
    img.alt = '';
    img.onerror = () => (img.style.visibility = 'hidden');
    const text = el('div');
    const mine = game.picks.some((p) => p.id === h.id);
    const note = mine ? '' : game.mode === 'lastpick' ? ' (уже был в команде)' : ' (случайный союзник)';
    text.append(el('div', '', `${heroName(h.id)}${note}`));
    text.append(el('div', 'detail', `против врагов ${pct(h.vs)} · с союзниками ${pct(h.team)}`));
    li.append(img, text, el('div', `score ${h.vs + h.team >= 0 ? 'pos' : 'neg'}`, signed(points(h.vs + h.team))));
    ol.append(li);
  }
  box.append(ol);

  box.append(el('h4', '', game.mode === 'lastpick' ? 'Ваш ластпик' : 'Ваши пики'));
  const ul = el('ul', 'game-picks');
  for (const p of game.picks) {
    const text =
      p.best === p.id
        ? `${heroName(p.id)}: лучший выбор на тот момент (${pct(p.score)}).`
        : `${heroName(p.id)}: ${p.rank}-й из ${p.of} вариантов (${pct(p.score)}). Лучше было взять ${heroName(p.best)} (${pct(p.bestScore)}).`;
    ul.append(el('li', '', text));
  }
  box.append(ul);

  if (game.enemyNotes.length) {
    box.append(el('h4', '', 'Пики соперника'));
    const en = el('ul', 'game-picks');
    for (const n of game.enemyNotes) en.append(el('li', '', n.text));
    box.append(en);
  }

  if (!state.dataset.with)
    box.append(el('p', 'hint', 'Синергия союзников не учтена: для неё нужен токен STRATZ (⚙). Сейчас очки считаются только по контрпикам.'));
  box.append(
    el(
      'p',
      'hint',
      'Очки: преимущество каждого вашего героя над каждым врагом и синергия союзников (драфт), плюс противостояния на линиях и пары на линии (линии). 1 очко = 0,1%.'
    )
  );
  return box;
}

function saveOptions() {
  DraftData.store.set(GAME_OPTIONS_KEY, { mode: game.mode, randomFirst: game.randomFirst });
}

function gameOptions() {
  const box = el('div', 'game-options');
  const modes = el('div', 'target-switch game-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Режим игры');
  for (const [key, label] of [['full', 'Полный драфт'], ['lastpick', 'Ластпик']]) {
    const b = el('button', game.mode === key ? 'active' : '', label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(game.mode === key));
    b.onclick = () => {
      game.mode = key;
      saveOptions();
      renderGame();
    };
    modes.append(b);
  }
  box.append(modes);
  if (game.mode === 'full') {
    const label = el('label', 'game-check');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.id = 'game-random-first';
    cb.checked = game.randomFirst;
    cb.onchange = () => {
      game.randomFirst = cb.checked;
      saveOptions();
      renderGame();
    };
    label.append(cb, document.createTextNode(' Первого героя союзника выбирает случай'));
    box.append(label);
  }
  return box;
}

function gameStatus() {
  const status = el('div', 'game-status');
  const s = game.steps[game.step];
  if (game.phase === 'idle' || game.phase === 'done') status.append(gameOptions());
  if (game.phase === 'idle') {
    status.append(
      el(
        'p',
        '',
        game.mode === 'lastpick'
          ? `Сначала банятся ${BAN_COUNT} случайных героев, затем в обеих командах уже стоят по 4 героя на разных позициях. Вам нужно сделать ластпик: выбрать пятого героя. В конце обе команды расставляют героев по линиям.`
          : `Сначала банятся ${BAN_COUNT} случайных героев. ${game.randomFirst ? 'Союзник выбирает случайного героя, вы выбираете четырёх' : 'Вы выбираете всех пятерых героев'}, а соперник выбирает одновременно с вами: первые два героя у него метовые, вслепую, дальше он контрит только тех ваших героев, что были выбраны в прошлых фазах, и закрывает все пять позиций. В конце обе команды расставляют героев по линиям.`
      )
    );
  } else if (game.phase === 'bans') {
    status.append(el('p', 'game-prompt', 'Баним случайных героев…'));
  } else if (game.phase === 'draft') {
    const steps = el('ol', 'game-steps');
    game.steps.forEach((x, i) => {
      const team = x.side === 'allies' ? (x.who === 'preset' ? `Союзники ×${x.n}` : 'Союзник') : `Соперник ×${x.n}`;
      const label = x.who === 'player' ? `Вы ×${x.n}` : team;
      steps.append(el('li', i < game.step ? 'done' : i === game.step ? 'now' : '', label));
    });
    status.append(steps, el('p', 'game-prompt', s.who === 'player' && s.n > 1 ? `${s.text} (осталось ${game.left})` : s.text));
  } else if (game.phase === 'lanes') {
    status.append(el('p', 'game-prompt', 'Драфт закончен. Расставьте своих героев по линиям.'));
  } else {
    status.append(el('p', '', 'Игра завершена.'));
  }
  const start = el('button', 'primary', game.phase === 'idle' ? 'Начать игру' : 'Новая игра');
  start.disabled = game.busy;
  start.onclick = startGame;
  status.append(start);
  return status;
}

function renderGame() {
  const root = $('#game-body');
  if (!root) return;
  root.replaceChildren();
  if (!state.dataset) {
    root.append(el('p', 'muted', 'Для игры нужна статистика матчей. Нажмите ⟳ вверху и дождитесь загрузки.'));
    $('#game-search').classList.add('hidden');
    return;
  }
  root.append(gameStatus());
  if (game.phase !== 'idle') {
    root.append(gameBans());
    const teams = el('div', 'game-teams');
    teams.append(gameTeam('allies', 'Ваша команда'), gameTeam('enemies', 'Соперник'));
    root.append(teams);
  }
  const s = game.steps[game.step];
  const choosing = game.phase === 'draft' && s && s.who === 'player';
  $('#game-search').classList.toggle('hidden', !choosing);
  if (choosing) root.append(gameGrid());
  if (game.phase === 'lanes' || game.phase === 'done') root.append(minimap());
  if (game.phase === 'done') root.append(gameResults());
}

function initGame() {
  const saved = DraftData.store.get(GAME_OPTIONS_KEY) || {};
  if (saved.mode === 'full' || saved.mode === 'lastpick') game.mode = saved.mode;
  if (typeof saved.randomFirst === 'boolean') game.randomFirst = saved.randomFirst;
  $('#btn-game').onclick = () => toggleGame();
  const search = $('#game-search');
  search.oninput = () => {
    game.search = search.value;
    renderGame();
  };
  search.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const q = game.search.trim().toLowerCase();
    const taken = gameTaken();
    const first = Object.values(state.heroes)
      .filter((h) => !taken.has(h.id) && h.localized.toLowerCase().includes(q))
      .sort((a, b) => a.localized.localeCompare(b.localized))[0];
    if (q && first) playerPick(first.id);
  };
}
