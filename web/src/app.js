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

function renderGrid() {
  const grid = $('#grid');
  grid.replaceChildren();
  const taken = allTaken();
  for (const h of filteredHeroes()) {
    const c = el('div', 'hero');
    c.style.backgroundImage = `url(${imgUrl(h)})`;
    c.title = h.localized;
    if (state.draft.allies.includes(h.id)) c.classList.add('ally');
    else if (state.draft.enemies.includes(h.id)) c.classList.add('enemy');
    else if (taken.has(h.id)) c.classList.add('taken');
    c.append(el('span', '', h.localized));
    c.onclick = () => {
      addToDraft(h.id);
      clearSearch();
    };
    c.oncontextmenu = (e) => {
      e.preventDefault();
      openHero(h.id);
    };
    grid.append(c);
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
  info.append(el('h3', '', h.localized), el('div', 'muted', (h.roles || []).join(', ')));
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
  card.append(head, actions);

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
