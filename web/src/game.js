/* global Scoring, DraftData, state, $, el, imgUrl, heroName, pct, minGames, ATTRIBUTES */
// Draft challenge mini-game: the player fills four of five slots while an ally
// and the enemy team pick at random, then the draft is scored with the same
// statistics the draft helper uses.

// Order of picks. 'random' steps happen on their own, 'player' steps wait for clicks.
const GAME_STEPS = [
  { side: 'allies', who: 'random', n: 1, text: 'Союзник выбирает случайного героя' },
  { side: 'allies', who: 'player', n: 1, text: 'Ваш ход: выберите героя' },
  { side: 'enemies', who: 'random', n: 2, text: 'Противники выбирают двух героев' },
  { side: 'allies', who: 'player', n: 2, text: 'Ваш ход: выберите двух героев' },
  { side: 'enemies', who: 'random', n: 2, text: 'Противники выбирают ещё двух героев' },
  { side: 'allies', who: 'player', n: 1, text: 'Последний ход: выберите заключительного героя' },
  { side: 'enemies', who: 'random', n: 1, text: 'Противники делают последний выбор' },
];
const GAME_RECORD_KEY = 'd2draft-game-record';
const RANDOM_PICK_DELAY_MS = 700;

const game = {
  open: false,
  allies: [],
  enemies: [],
  step: -1,
  left: 0,
  busy: false,
  search: '',
  picks: [], // player picks with the best option at that moment
  result: null,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gameTaken = () => new Set([...game.allies, ...game.enemies]);
const points = (v) => Math.round(v * 1000);
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

function randomFree() {
  const taken = gameTaken();
  const free = Object.keys(state.heroes).map(Number).filter((id) => !taken.has(id));
  return free[Math.floor(Math.random() * free.length)];
}

function toggleGame(open = !game.open) {
  game.open = open;
  $('.layout').classList.toggle('hidden', open);
  $('#game').classList.toggle('hidden', !open);
  $('#btn-game').textContent = open ? '← К драфту' : '🎲 Мини-игра';
  if (open && game.step === -1) renderGame();
}

async function startGame() {
  Object.assign(game, { allies: [], enemies: [], step: 0, left: 0, picks: [], result: null, search: '' });
  $('#game-search').value = '';
  await runSteps();
}

// Plays random steps until the player has to choose, or the draft is over.
async function runSteps() {
  game.busy = true;
  while (game.step < GAME_STEPS.length && GAME_STEPS[game.step].who === 'random') {
    const s = GAME_STEPS[game.step];
    renderGame();
    for (let i = 0; i < s.n; i++) {
      await sleep(RANDOM_PICK_DELAY_MS);
      game[s.side].push(randomFree());
      renderGame();
    }
    game.step++;
  }
  game.busy = false;
  if (game.step >= GAME_STEPS.length) finishGame();
  else game.left = GAME_STEPS[game.step].n;
  renderGame();
}

function playerPick(id) {
  const s = GAME_STEPS[game.step];
  if (game.busy || !s || s.who !== 'player' || gameTaken().has(id)) return;
  // Rate the pick against what was known at that moment.
  const options = Scoring.suggestPicks(state.dataset, {
    allies: game.allies,
    enemies: game.enemies,
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

// Scores the final draft: every ally against every enemy, plus every pair of allies.
function scoreDraft(d, allies, enemies) {
  const mg = minGames();
  const val = (r) => (r ? r.value : 0);
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

function verdict(p) {
  if (p >= 100) return 'Отличный драфт';
  if (p >= 30) return 'Хороший драфт';
  if (p > -30) return 'Средний драфт';
  return 'Слабый драфт';
}

function finishGame() {
  const r = scoreDraft(state.dataset, game.allies, game.enemies);
  const score = points(r.total);
  const record = DraftData.store.get(GAME_RECORD_KEY);
  const isRecord = record === null || score > record;
  if (isRecord) DraftData.store.set(GAME_RECORD_KEY, score);
  game.result = { ...r, score, record: isRecord ? score : record, isRecord };
}

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
      s.append(el('span', '', heroName(id)));
      s.title = heroName(id);
    }
    row.append(s);
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
      c.title = h.localized;
      c.append(el('span', '', h.localized));
      if (game.allies.includes(h.id)) c.classList.add('ally');
      else if (game.enemies.includes(h.id)) c.classList.add('enemy');
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
    el('div', '', verdict(r.score)),
    el('div', 'muted', r.isRecord ? 'Новый рекорд!' : `Рекорд: ${signed(r.record)}`)
  );
  box.append(head);

  box.append(el('h4', '', 'Вклад героев вашей команды'));
  const ol = el('ol', 'list');
  for (const h of r.heroes) {
    const li = el('li');
    const img = el('img');
    img.src = imgUrl(state.heroes[h.id]);
    img.alt = '';
    img.onerror = () => (img.style.visibility = 'hidden');
    const text = el('div');
    const mine = game.picks.some((p) => p.id === h.id);
    text.append(el('div', '', `${heroName(h.id)}${mine ? '' : ' (случайный союзник)'}`));
    text.append(el('div', 'detail', `против врагов ${pct(h.vs)} · с союзниками ${pct(h.team)}`));
    li.append(img, text, el('div', `score ${h.vs + h.team >= 0 ? 'pos' : 'neg'}`, signed(points(h.vs + h.team))));
    ol.append(li);
  }
  box.append(ol);

  box.append(el('h4', '', 'Ваши пики'));
  const ul = el('ul', 'game-picks');
  for (const p of game.picks) {
    const text =
      p.best === p.id
        ? `${heroName(p.id)}: лучший выбор на тот момент (${pct(p.score)}).`
        : `${heroName(p.id)}: ${p.rank}-й из ${p.of} вариантов (${pct(p.score)}). Лучше было взять ${heroName(p.best)} (${pct(p.bestScore)}).`;
    ul.append(el('li', '', text));
  }
  box.append(ul);
  if (!state.dataset.with)
    box.append(el('p', 'hint', 'Синергия союзников не учтена: для неё нужен токен STRATZ (⚙). Сейчас очки считаются только по контрпикам.'));
  box.append(el('p', 'hint', 'Очки: сумма преимуществ каждого вашего героя против каждого врага и синергии каждой пары союзников по статистике матчей, 1 очко = 0,1%.'));
  return box;
}

function renderGame() {
  const root = $('#game-body');
  if (!root) return;
  root.replaceChildren();
  if (!state.dataset) {
    root.append(el('p', 'muted', 'Для игры нужна статистика матчей. Нажмите ⟳ вверху и дождитесь загрузки.'));
    return;
  }
  const s = GAME_STEPS[game.step];
  const status = el('div', 'game-status');
  if (game.step === -1) {
    status.append(el('p', '', 'Союзник и противники выбирают героев случайно, вы выбираете четырёх героев в свою команду. В конце драфт оценивается по статистике.'));
  } else if (game.result) {
    status.append(el('p', '', 'Драфт завершён.'));
  } else {
    const steps = el('ol', 'game-steps');
    GAME_STEPS.forEach((x, i) => {
      const li = el('li', i < game.step ? 'done' : i === game.step ? 'now' : '', x.who === 'player' ? `Вы ×${x.n}` : x.side === 'allies' ? 'Союзник' : `Враги ×${x.n}`);
      steps.append(li);
    });
    status.append(steps, el('p', 'game-prompt', s.who === 'player' && s.n > 1 ? `${s.text} (осталось ${game.left})` : s.text));
  }
  const start = el('button', 'primary', game.step === -1 ? 'Начать игру' : 'Новая игра');
  start.disabled = game.busy;
  start.onclick = startGame;
  status.append(start);
  root.append(status);

  const teams = el('div', 'game-teams');
  teams.append(gameTeam('allies', 'Ваша команда'), gameTeam('enemies', 'Противники'));
  root.append(teams);

  const choosing = !game.result && s && s.who === 'player';
  $('#game-search').classList.toggle('hidden', !choosing);
  if (game.result) root.append(gameResults());
  else if (choosing) root.append(gameGrid());
}

function initGame() {
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
