/* global Scoring, DraftData */
// Web adapter with the same interface the desktop overlay had in preload.js.
const SETTINGS_KEY = 'd2draft-settings';
let progressFn = () => {};
const loadSettings = () => ({ stratzToken: '', bracket: 'ALL', ...(DraftData.store.get(SETTINGS_KEY) || {}) });
window.api = {
  getSettings: async () => ({ ...loadSettings(), brackets: DraftData.BRACKETS }),
  setSettings: async (patch) => {
    DraftData.store.set(SETTINGS_KEY, { ...loadSettings(), ...patch });
    return { failedHotkeys: [] };
  },
  getCachedData: async () => ({ ...DraftData.cached(loadSettings().bracket), heroes: window.HERO_LIST }),
  refreshData: async () => {
    try {
      const s = loadSettings();
      return { dataset: await DraftData.refresh(window.HERO_LIST, { bracket: s.bracket, token: s.stratzToken, onProgress: progressFn }) };
    } catch (e) {
      return { error: e.message };
    }
  },
  onProgress: (fn) => (progressFn = fn),
};

const CDN = 'https://cdn.cloudflare.steamstatic.com';
const SLOTS = { allies: 5, enemies: 5, bans: 16 };

const state = {
  heroes: {},
  dataset: null,
  draft: { allies: [], enemies: [], bans: [] },
  target: 'allies',
  focusHero: null,
  compareFrom: null,
  search: '',
  role: '',
  settings: null,
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};
const imgUrl = (h) => (h && h.img ? CDN + h.img : '');
const heroName = (id) => (state.heroes[id] ? state.heroes[id].localized : `#${id}`);
const pct = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;
const minGames = () => (state.dataset ? state.dataset.minGames || 0 : 0);

function setStatus(text) {
  $('#status').textContent = text;
}

function datasetStatus() {
  const d = state.dataset;
  if (!d) return 'Нет статистики, нажмите ⟳';
  const src = d.source === 'stratz' ? 'STRATZ' : 'OpenDota';
  const when = new Date(d.updatedAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
  return `${src} · ${when}`;
}

function showWarning(text) {
  const w = $('#warning');
  w.textContent = text || '';
  w.classList.toggle('hidden', !text);
}

// ---------- draft ----------

function allTaken() {
  return new Set([...state.draft.allies, ...state.draft.enemies, ...state.draft.bans]);
}

function addToDraft(id, target = state.target) {
  if (finishCompare(id)) return;
  if (allTaken().has(id)) return;
  const list = state.draft[target];
  if (list.length >= SLOTS[target]) return;
  list.push(id);
  render();
}

function removeFromDraft(target, id) {
  state.draft[target] = state.draft[target].filter((x) => x !== id);
  render();
}

function renderSlots() {
  for (const target of Object.keys(SLOTS)) {
    const box = $(`#slots-${target}`);
    box.replaceChildren();
    const list = state.draft[target];
    for (let i = 0; i < SLOTS[target]; i++) {
      const id = list[i];
      const s = el('div', 'slot');
      if (id) {
        s.classList.add('filled');
        s.style.backgroundImage = `url(${imgUrl(state.heroes[id])})`;
        s.title = `${heroName(id)}: клик — убрать`;
        s.onclick = () => removeFromDraft(target, id);
        s.oncontextmenu = (e) => {
          e.preventDefault();
          openHero(id);
        };
      } else {
        s.onclick = () => setTarget(target);
      }
      box.append(s);
    }
  }
}

function setTarget(target) {
  state.target = target;
  for (const b of document.querySelectorAll('.target-switch button')) {
    b.classList.toggle('active', b.dataset.target === target);
  }
  $('#search').focus();
}

// ---------- hero pool ----------

function filteredHeroes() {
  const q = state.search.trim().toLowerCase();
  return Object.values(state.heroes)
    .filter((h) => !q || h.localized.toLowerCase().includes(q) || h.name.includes(q.replace(/\s+/g, '_')))
    .sort((a, b) => a.localized.localeCompare(b.localized));
}

const ATTRIBUTES = [
  ['str', 'Сила'],
  ['agi', 'Ловкость'],
  ['int', 'Интеллект'],
  ['all', 'Универсальные'],
];

function heroTile(h, taken) {
  const c = el('div', 'hero');
  c.style.backgroundImage = `url(${imgUrl(h)})`;
  c.title = h.localized;
  if (state.draft.allies.includes(h.id)) c.classList.add('ally');
  else if (state.draft.enemies.includes(h.id)) c.classList.add('enemy');
  else if (taken.has(h.id)) c.classList.add('taken');
  c.append(el('span', '', h.localized));
  c.onclick = (e) => {
    if (e.shiftKey && !state.comparing) startCompare(h.id);
    else addToDraft(h.id);
    clearSearch();
  };
  c.oncontextmenu = (e) => {
    e.preventDefault();
    openHero(h.id);
  };
  return c;
}

// Heroes grouped by primary attribute, the way the in-game hero grid is.
function renderGrid() {
  const box = $('#grid');
  box.replaceChildren();
  const taken = allTaken();
  const heroes = filteredHeroes();
  const known = new Set(ATTRIBUTES.map(([key]) => key));
  const groups = [...ATTRIBUTES, ['other', 'Другие']];
  for (const [key, label] of groups) {
    const list = heroes.filter((h) => (key === 'other' ? !known.has(h.attr) : h.attr === key));
    if (!list.length) continue;
    const head = el('h3', `attr-head attr-${key}`);
    head.append(el('span', 'attr-dot'), el('span', '', label), el('span', 'muted', ` ${list.length}`));
    const grid = el('div', 'grid');
    for (const h of list) grid.append(heroTile(h, taken));
    box.append(head, grid);
  }
}

function clearSearch() {
  if (!state.search) return;
  state.search = '';
  $('#search').value = '';
  renderGrid();
}

// ---------- side panel ----------

function listItem(id, score, detail, onClick) {
  const li = el('li');
  const img = el('img');
  img.src = imgUrl(state.heroes[id]);
  img.alt = '';
  img.onerror = () => (img.style.visibility = 'hidden');
  const text = el('div');
  text.append(el('div', '', heroName(id)));
  if (detail) text.append(el('div', 'detail', detail));
  li.append(img, text, el('div', `score ${score >= 0 ? 'pos' : 'neg'}`, pct(score)));
  li.title = 'Клик: добавить в выбранную группу. Правый клик: карточка героя.';
  li.onclick = onClick || (() => addToDraft(id));
  li.oncontextmenu = (e) => {
    e.preventDefault();
    openHero(id);
  };
  return li;
}

function breakdown(entry) {
  const parts = [];
  for (const p of entry.vs) if (p.games) parts.push(`против ${heroName(p.id)} ${pct(p.value)}`);
  for (const p of entry.with) if (p.games) parts.push(`с ${heroName(p.id)} ${pct(p.value)}`);
  return parts.join(', ');
}

function renderSuggestions() {
  const picks = $('#picks');
  const bans = $('#bans-suggest');
  picks.replaceChildren();
  bans.replaceChildren();
  if (!state.dataset) {
    picks.append(el('li', 'muted', 'Нужна статистика: нажмите ⟳.'));
    return;
  }
  const { allies, enemies } = state.draft;
  if (!allies.length && !enemies.length) {
    picks.append(el('li', 'muted', 'Добавьте выбранных героев, и здесь появятся подсказки.'));
    return;
  }
  const opts = { ...state.draft, minGames: minGames(), role: state.role };
  for (const s of Scoring.suggestPicks(state.dataset, { ...opts, limit: 15 })) {
    picks.append(listItem(s.id, s.score, breakdown(s), () => addToDraft(s.id, 'allies')));
  }
  for (const s of Scoring.suggestBans(state.dataset, { ...opts, limit: 8 })) {
    bans.append(listItem(s.id, s.score, breakdown(s), () => addToDraft(s.id, 'bans')));
  }
}

function openHero(id) {
  if (finishCompare(id)) return;
  state.focusHero = id;
  switchTab('hero');
  renderHeroCard();
}

function renderHeroCard() {
  const card = $('#hero-card');
  const id = state.focusHero;
  if (!id) return;
  const h = state.heroes[id];
  card.replaceChildren();

  const head = el('header');
  const img = el('img');
  img.src = imgUrl(h);
  img.alt = '';
  img.onerror = () => (img.style.visibility = 'hidden');
  const info = el('div');
  const attr = (ATTRIBUTES.find(([key]) => key === h.attr) || [])[1];
  info.append(el('h3', '', h.localized), el('div', 'muted', [attr, ...(h.roles || [])].filter(Boolean).join(', ')));
  if (state.dataset) {
    info.append(el('div', 'muted', `Винрейт: ${(Scoring.baseWinrate(state.dataset, id) * 100).toFixed(1)}%`));
  }
  head.append(img, info);

  const actions = el('div', 'actions');
  for (const [target, label] of [['allies', '+ Мы'], ['enemies', '+ Враги'], ['bans', 'Бан']]) {
    const b = el('button', '', label);
    b.onclick = () => addToDraft(id, target);
    actions.append(b);
  }
  const cmp = el('button', 'wide', '⇄ Сравнить с другим героем');
  cmp.onclick = () => startCompare(id);
  card.append(head, actions, cmp);

  if (!state.dataset) {
    card.append(el('p', 'muted', 'Нет статистики: нажмите ⟳.'));
    return;
  }
  const p = Scoring.heroProfile(state.dataset, id, { limit: 8, minGames: minGames() });
  const section = (title, items, emptyText) => {
    card.append(el('h4', '', title));
    const ol = el('ol', 'list');
    if (!items.length) ol.append(el('li', 'muted', emptyText));
    for (const it of items) ol.append(listItem(it.id, it.value, `${it.games.toLocaleString('ru-RU')} игр`));
    card.append(ol);
  };
  const noStratz = 'Нужен токен STRATZ (⚙).';
  section('Напарники на линии', state.dataset.lane ? p.lanePartners : [], state.dataset.lane ? 'Мало данных.' : noStratz);
  section('Союзники в матче', state.dataset.with ? p.teammates : [], state.dataset.with ? 'Мало данных.' : noStratz);
  section('Кого контрит', p.counters, 'Мало данных.');
  section('Кто контрит его', p.counteredBy.map((x) => ({ ...x, value: -x.value })), 'Мало данных.');
}

function switchTab(tab) {
  for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('active', b.dataset.tab === tab);
  $('#tab-suggest').classList.toggle('hidden', tab !== 'suggest');
  $('#tab-hero').classList.toggle('hidden', tab !== 'hero');
}

function render() {
  renderSlots();
  renderGrid();
  renderSuggestions();
  renderHeroCard();
}

// ---------- comparing two heroes ----------

// Without an id the first hero is still to be chosen.
function startCompare(id) {
  state.comparing = true;
  state.compareFrom = id || null;
  $('#compare-text').textContent = id
    ? `Сравнение с ${heroName(id)}: выберите второго героя.`
    : 'Сравнение: выберите первого героя.';
  $('#compare-banner').classList.remove('hidden');
  $('#btn-compare').textContent = '✕ Отменить';
  $('#search').focus();
}

function cancelCompare() {
  state.comparing = false;
  state.compareFrom = null;
  $('#compare-banner').classList.add('hidden');
  $('#btn-compare').textContent = '⇄ Сравнить';
}

// In comparison mode a chosen hero becomes part of the pair instead of
// getting its usual action. Returns true when it did.
function finishCompare(id) {
  if (!state.comparing) return false;
  const from = state.compareFrom;
  if (!from) {
    startCompare(id);
    return true;
  }
  if (from === id) return true;
  cancelCompare();
  openCompare(from, id);
  return true;
}

function strength(v) {
  const a = Math.abs(v);
  return a < 0.03 ? 'немного' : a < 0.06 ? 'заметно' : 'сильно';
}

const NEUTRAL = 0.01;

function versusText(v, a, b) {
  if (!v) return 'Нет данных о матчах друг против друга.';
  if (Math.abs(v.value) < NEUTRAL) return 'Примерно на равных: ни один не контрит другого.';
  const [win, lose] = v.value > 0 ? [a, b] : [b, a];
  return `${heroName(win)} ${strength(v.value)} контрит ${heroName(lose)}.`;
}

function togetherText(v) {
  if (Math.abs(v.value) < NEUTRAL) return 'Нейтральная пара: вместе играют так, как и ожидается по их винрейтам.';
  return v.value > 0
    ? `Хорошо сочетаются: вместе выигрывают ${strength(v.value)} чаще ожидаемого.`
    : `Плохо сочетаются: вместе выигрывают ${strength(v.value)} реже ожидаемого.`;
}

function laneText(v) {
  if (Math.abs(v.value) < NEUTRAL) return 'На общей линии выступают средне.';
  return v.value > 0
    ? `Сильная пара на линии: ${strength(v.value)} чаще выигрывают линию, чем проигрывают.`
    : `Слабая пара на линии: ${strength(v.value)} чаще проигрывают линию.`;
}

const wr = (x) => `${(x * 100).toFixed(1)}%`;
const games = (n) => `${n.toLocaleString('ru-RU')} игр`;

function compareSection(title, score, text, facts) {
  const sec = el('section', 'cmp-section');
  const head = el('div', 'cmp-head');
  head.append(el('h4', '', title));
  if (score) head.append(el('span', `score ${score.value >= 0 ? 'pos' : 'neg'}`, pct(score.value)));
  sec.append(head, el('p', '', text));
  if (facts.length) sec.append(el('p', 'detail', facts.join(' · ')));
  return sec;
}

function heroBadge(id, base) {
  const box = el('div', 'cmp-hero');
  const img = el('img');
  img.src = imgUrl(state.heroes[id]);
  img.alt = '';
  img.onerror = () => (img.style.visibility = 'hidden');
  box.append(img, el('strong', '', heroName(id)), el('span', 'muted', `винрейт ${wr(base)}`));
  return box;
}

function noteList(title, items, empty) {
  const box = el('div', 'cmp-notes');
  box.append(el('h5', '', title));
  const ul = el('ul');
  if (!items.length) ul.append(el('li', 'muted', empty));
  for (const t of items) ul.append(el('li', '', t));
  box.append(ul);
  return box;
}

// Ability-by-ability breakdown; works without match statistics.
function abilitySections(a, b) {
  const sec = el('section', 'cmp-section cmp-abilities');
  const r = window.AbilityAnalysis && window.ABILITIES ? AbilityAnalysis.analyzePair(window.ABILITIES, state.heroes, a, b) : null;
  sec.append(el('h4', '', 'Разбор по способностям'));
  if (!r) {
    sec.append(el('p', 'muted', 'Нет данных о способностях этих героев.'));
    return sec;
  }
  const na = heroName(a);
  const nb = heroName(b);
  sec.append(
    noteList(`Чем ${na} опасен для ${nb}`, r.aOverB, 'Явных преимуществ по способностям не найдено.'),
    noteList(`Чем ${nb} опасен для ${na}`, r.bOverA, 'Явных преимуществ по способностям не найдено.'),
    noteList('В одной команде', r.together, 'Особых связок способностей не найдено.'),
    noteList('На одной линии', r.lane, 'Особых связок для линии не найдено.')
  );
  const abl = el('p', 'detail');
  abl.textContent = `Способности ${na}: ${r.abilitiesA.join(', ')}. Способности ${nb}: ${r.abilitiesB.join(', ')}.`;
  sec.append(abl, el('p', 'hint', 'Разбор составлен автоматически по описаниям способностей и может что-то упускать: таланты, аганим и предметы не учитываются.'));
  return sec;
}

function openCompare(a, b) {
  const body = $('#compare-body');
  body.replaceChildren();
  const d = state.dataset;
  if (!d) {
    body.append(el('p', 'muted', 'Статистика матчей ещё не загружена: нажмите ⟳.'), abilitySections(a, b));
    $('#compare').showModal();
    return;
  }
  const r = Scoring.pairReport(d, a, b, minGames());

  const heads = el('div', 'cmp-heroes');
  const swap = el('button', '', '⇄');
  swap.title = 'Поменять местами';
  swap.onclick = () => openCompare(b, a);
  heads.append(heroBadge(a, r.baseA), swap, heroBadge(b, r.baseB));
  body.append(heads);

  const vsFacts = [];
  if (r.versusRaw) vsFacts.push(`${heroName(a)} выигрывает ${wr(r.versusRaw.winrate)} матчей против ${heroName(b)}`, games(r.versusRaw.games));
  body.append(compareSection('Друг против друга', r.versus, versusText(r.versus, a, b), vsFacts));

  const noStratz = 'Нужен токен STRATZ (⚙), чтобы увидеть эти данные.';
  const lowData = 'Мало совместных матчей, чтобы делать выводы.';
  body.append(
    compareSection(
      'В одной команде',
      r.together,
      !d.with ? noStratz : r.together ? togetherText(r.together) : lowData,
      r.togetherRaw ? [`вместе выигрывают ${wr(r.togetherRaw.winrate)}`, games(r.togetherRaw.games)] : []
    )
  );
  body.append(
    compareSection(
      'На одной линии',
      r.lane,
      !d.lane ? noStratz : r.lane ? laneText(r.lane) : lowData,
      r.laneRaw ? [`линия выиграна ${wr(r.laneRaw.won)}`, `проиграна ${wr(r.laneRaw.lost)}`, games(r.laneRaw.games)] : []
    )
  );
  body.append(el('p', 'hint', 'Проценты показывают, насколько результат лучше или хуже ожидаемого по общим винрейтам героев.'));
  body.append(abilitySections(a, b));
  $('#compare').showModal();
}

// ---------- data ----------

function applyDataset(dataset) {
  state.dataset = dataset;
  if (dataset) {
    for (const h of Object.values(dataset.heroes)) state.heroes[h.id] = { ...state.heroes[h.id], ...h };
  }
  setStatus(datasetStatus());
  showWarning(dataset && dataset.warning);
  render();
}

async function refresh() {
  $('#btn-refresh').disabled = true;
  setStatus('Обновляю статистику…');
  const res = await window.api.refreshData();
  $('#btn-refresh').disabled = false;
  if (res.error) {
    setStatus(datasetStatus());
    showWarning(`Не удалось загрузить статистику: ${res.error}`);
    return;
  }
  applyDataset(res.dataset);
}

// ---------- settings ----------

function openSettings() {
  const s = state.settings;
  $('#s-token').value = s.stratzToken || '';
  $('#s-error').textContent = '';
  $('#settings').showModal();
}

async function saveSettings(e) {
  e.preventDefault();
  const tokenChanged = $('#s-token').value.trim() !== (state.settings.stratzToken || '');
  const patch = { stratzToken: $('#s-token').value.trim() };
  await window.api.setSettings(patch);
  Object.assign(state.settings, patch);
  $('#settings').close();
  if (tokenChanged) refresh();
}

async function changeBracket() {
  const bracket = $('#bracket').value;
  state.settings.bracket = bracket;
  await window.api.setSettings({ bracket });
  const cached = await window.api.getCachedData();
  if (cached.dataset) applyDataset(cached.dataset);
  if (cached.stale) refresh();
}

// ---------- init ----------

async function init() {
  state.settings = await window.api.getSettings();
  const sel = $('#bracket');
  for (const [key, b] of Object.entries(state.settings.brackets)) {
    const o = el('option', '', b.label);
    o.value = key;
    sel.append(o);
  }
  sel.value = state.settings.bracket;

  const cached = await window.api.getCachedData();
  for (const h of cached.heroes) state.heroes[h.id] = h;
  applyDataset(cached.dataset);
  if (cached.stale) refresh();

  window.api.onProgress(setStatus);

  // Statistics baked into the page cannot be refreshed or re-filtered here.
  if (DraftData.embedded()) {
    for (const id of ['#btn-refresh', '#btn-settings', '#bracket']) $(id).classList.add('hidden');
  }
  $('#btn-refresh').onclick = refresh;
  $('#btn-settings').onclick = openSettings;
  $('#btn-reset').onclick = () => {
    state.draft = { allies: [], enemies: [], bans: [] };
    render();
  };
  $('#s-save').onclick = saveSettings;
  $('#compare-cancel').onclick = cancelCompare;
  $('#btn-compare').onclick = () => (state.comparing ? cancelCompare() : startCompare());
  $('#compare-close').onclick = () => $('#compare').close();
  sel.onchange = changeBracket;
  $('#role').onchange = (e) => {
    state.role = e.target.value;
    renderSuggestions();
  };
  for (const b of document.querySelectorAll('.target-switch button')) b.onclick = () => setTarget(b.dataset.target);
  for (const b of document.querySelectorAll('.tabs button')) b.onclick = () => switchTab(b.dataset.tab);

  const search = $('#search');
  search.oninput = () => {
    state.search = search.value;
    renderGrid();
  };
  search.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const first = filteredHeroes().find((h) => !allTaken().has(h.id));
      if (first) addToDraft(first.id);
      clearSearch();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (state.comparing) cancelCompare();
      clearSearch();
    }
  };
  // Tab in the search box cycles the target group: Мы → Враги → Бан.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && document.activeElement === search) {
      e.preventDefault();
      const order = ['allies', 'enemies', 'bans'];
      setTarget(order[(order.indexOf(state.target) + 1) % order.length]);
    }
  });
  search.focus();
}

init();
