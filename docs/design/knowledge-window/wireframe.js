import { data, esc, goodById, goodIcon } from './model.js';
import { PLAN_PAGE, SCREENS } from './screens.js';
import { CATEGORIES, encyclopediaView } from './view-encyclopedia.js';
import { ARTICLES, howtoView, mechanicsView } from './view-mechanics.js';
import { productionView } from './view-production.js';
import { TABLES, tablesView } from './view-tables.js';

const TABS = [
  { id: 'production', name: 'Produkcja' },
  { id: 'encyclopedia', name: 'Encyklopedia' },
  { id: 'mechanics', name: 'Mechaniki' },
  { id: 'tables', name: 'Tabele' },
  { id: 'howto', name: 'Jak grać' },
];
const FRAMES = [
  { id: 'min', name: '1024×768 (najmniejszy)', width: 1024, height: 768 },
  { id: 'wide', name: '1600×900', width: 1600, height: 900 },
  { id: 'full', name: '1920×1080', width: 1920, height: 1080 },
];
const TOP = 96;
const BEAM_H = 72;
const MINIMAP_RIGHT = 285;
const WINDOW_MAX_W = 1240;
const WINDOW_MIN_W = 920;
const MAX_STAGE_SCALE = 1.5;

const base = {
  screen: 'overview',
  surface: 'game',
  mode: 'game',
  frame: 'wide',
  tribe: 1,
  onlyMap: true,
  query: '',
  zoom: 1,
  matrix: { metric: 'damage', direction: 100, hits: 0, strength: false, defense: false, heroes: false },
};
const NAV_DEFAULT = {
  tab: 'production',
  lens: 'goods',
  entry: null,
  onlyChain: false,
  category: 'goods',
  table: 'matrix',
  article: 'tools',
  howto: 'why',
};
let state = { ...base, ...NAV_DEFAULT };
const past = [];
const future = [];

const navOf = (s) => ({
  tab: s.tab,
  lens: s.lens,
  entry: s.entry,
  onlyChain: s.onlyChain,
  category: s.category,
  table: s.table,
  article: s.article,
  howto: s.howto,
});

/** One navigation owner: every link goes through here, so back and forward cover all of it. */
function go(change) {
  past.push(navOf(state));
  future.length = 0;
  state = { ...state, query: '', ...change };
  render();
}

function parseEntry(key) {
  const at = key.indexOf(':');
  return { kind: key.slice(0, at), id: key.slice(at + 1) };
}

const categoryOf = (entry) =>
  ({
    good: 'goods',
    building: 'buildings',
    job: 'jobs',
    vehicle: 'vehicles',
    animal: 'animals',
    tribe: 'tribes',
    world: 'world',
  })[entry.kind];

function searchIndex() {
  const pages = [];
  for (const g of data.goods)
    pages.push({
      group: 'Towary',
      name: g.name,
      go: { tab: 'encyclopedia', category: 'goods', entry: { kind: 'good', id: g.id } },
      picture: goodIcon(g),
    });
  for (const b of data.buildings)
    pages.push({
      group: 'Budynki',
      name: b.name,
      go: { tab: 'encyclopedia', category: 'buildings', entry: { kind: 'building', id: b.id } },
    });
  for (const j of data.jobs)
    pages.push({
      group: 'Zawody',
      name: j.name,
      go: { tab: 'encyclopedia', category: 'jobs', entry: { kind: 'job', id: j.id } },
    });
  for (const a of ARTICLES.flatMap((g) => g.items))
    pages.push({ group: 'Mechaniki', name: a.name, go: { tab: 'mechanics', article: a.id } });
  for (const t of TABLES.flatMap((g) => g.items))
    pages.push({ group: 'Tabele', name: t.name, go: { tab: 'tables', table: t.id } });
  return pages;
}
const INDEX = searchIndex();
const fold = (text) =>
  text.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ł', 'l');

function searchView(query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hits = INDEX.filter((page) => words.every((w) => fold(page.name).includes(w)));
  if (hits.length === 0) {
    return `<div class="on-parchment kn-page kn-search-empty"><h3>Nic nie znaleziono</h3><p>Szukamy w nazwach towarów, budynków, zawodów, mechanik i tabel. Spróbuj krótszego słowa.</p></div>`;
  }
  const groups = [...new Set(hits.map((h) => h.group))];
  const body = groups
    .map((group) => {
      const rows = hits
        .filter((h) => h.group === group)
        .slice(0, 12)
        .map(
          (h) =>
            `<button class="kn-row" data-search-hit="${INDEX.indexOf(h)}">${h.picture ?? ''}<span>${esc(h.name)}</span></button>`,
        )
        .join('');
      return `<section><h3 class="on-section">${group} · ${hits.filter((h) => h.group === group).length}</h3><div class="kn-hits">${rows}</div></section>`;
    })
    .join('');
  return `<div class="on-parchment kn-page">${body}</div>`;
}

function crumbs() {
  const trail = [TABS.find((t) => t.id === state.tab).name];
  if (state.tab === 'production')
    trail.push({ goods: 'Towary', buildings: 'Budynki', jobs: 'Zawody' }[state.lens]);
  if (state.tab === 'encyclopedia') trail.push(CATEGORIES.find((c) => c.id === state.category).name);
  if (state.tab === 'mechanics')
    trail.push(ARTICLES.flatMap((g) => g.items).find((a) => a.id === state.article).name);
  if (state.tab === 'tables')
    trail.push(TABLES.flatMap((g) => g.items).find((t) => t.id === state.table).name);
  const e = state.entry;
  if (e !== null && (state.tab === 'production' || state.tab === 'encyclopedia')) {
    const name =
      e.kind === 'good'
        ? goodById.get(e.id)?.name
        : e.kind === 'building'
          ? data.buildings.find((b) => b.id === e.id)?.name
          : e.kind === 'job'
            ? data.jobs.find((j) => j.id === e.id)?.name
            : e.id;
    if (name !== undefined) trail.push(name);
  }
  return trail.map((t) => `<span>${esc(t)}</span>`).join('<i>›</i>');
}

function knowledgeBody() {
  const tabs = TABS.map(
    (t) =>
      `<button class="on-tab" role="tab" aria-selected="${state.tab === t.id}" data-tab="${t.id}">${t.name}</button>`,
  ).join('');
  const tribes = data.tribes
    .map(
      (t) =>
        `<option value="${t.typeId}" ${t.typeId === state.tribe ? 'selected' : ''}>${esc(t.name)}</option>`,
    )
    .join('');
  const mapToggle =
    state.mode === 'game'
      ? `<label class="kn-toggle"><input type="checkbox" data-only-map ${state.onlyMap ? 'checked' : ''}> Stan mojej osady</label>`
      : `<span class="kn-mapnote">Wszystkie mapy</span>`;
  const views = {
    production: productionView,
    encyclopedia: encyclopediaView,
    mechanics: mechanicsView,
    tables: tablesView,
    howto: howtoView,
  };
  const main = state.query.trim() === '' ? views[state.tab](state) : searchView(state.query);
  return `<div class="kn-tabs on-tabs" role="tablist">${tabs}</div>
    <div class="kn-tool">
      <button class="on-medallion kn-nav" data-back ${past.length === 0 ? 'disabled' : ''} aria-label="Wstecz">‹</button>
      <button class="on-medallion kn-nav" data-forward ${future.length === 0 ? 'disabled' : ''} aria-label="Dalej">›</button>
      <div class="kn-crumbs">${crumbs()}</div>
      <label class="on-res-field on-res-field--search kn-search"><input type="search" placeholder="Szukaj w Wiedzy" value="${esc(state.query)}" data-search></label>
      <label class="kn-tribe">Plemię <select data-tribe>${tribes}</select></label>
      ${mapToggle}
    </div>
    <div class="kn-main">${main}</div>`;
}

function chrome(title, body, style, extraClass = '') {
  return `<section class="on-window on-panel kn-window ${extraClass}" style="${style}" aria-label="${title}">
    <svg aria-hidden="true" class="on-window__knot"><use href="#on-knot"/></svg>
    ${['tl', 'tr', 'bl', 'br'].map((c) => `<svg aria-hidden="true" class="on-window__corner on-window__corner--${c}"><use href="#on-corner"/></svg>`).join('')}
    <header class="on-window__head on-window__head--compact"><div class="on-window__heading"><span class="on-icon kn-book-icon"></span><div><h2 class="on-window__title on-window__title--compact">${title}</h2></div></div>
    <button class="on-medallion on-window__close" data-close aria-label="Zamknij"><svg class="on-glyph" width="18" height="18"><use href="#on-close"/></svg></button></header>
    <div class="on-window__body on-window__body--column kn-body">${body}</div>
  </section>`;
}

function gameFrame(size) {
  let width = Math.min(WINDOW_MAX_W, size.width - MINIMAP_RIGHT - 8);
  let x = Math.min(Math.max(Math.round((size.width - width) / 2), MINIMAP_RIGHT), size.width - width);
  if (width < WINDOW_MIN_W) {
    width = size.width - 24;
    x = 12;
  }
  const beamTop = size.height - BEAM_H;
  const height = beamTop - 8 - TOP;
  const open = state.screen !== 'closed';
  return `<div class="wf-world">
    <div class="wf-region wf-region--bar">Górny pasek</div>
    <div class="wf-region wf-region--notices">Powiadomienia</div>
    <div class="wf-region wf-region--minimap">Minimapa</div>
    <div class="wf-region wf-region--beam"><b class="${open ? 'is-open' : ''}">Wiedza · F7</b></div>
  </div>${open ? chrome('Wiedza', knowledgeBody(), `left:${x}px;top:${TOP}px;width:${width}px;height:${height}px`) : ''}`;
}

function menuHome() {
  const items = [
    'Nowa gra',
    'Wczytaj grę',
    'Multiplayer',
    'Katalog map',
    'Wiedza',
    'Ustawienia',
    'Informacje',
  ];
  return `<div class="wf-menu"><img class="wf-menu__shot" src="/review/menu.png" alt=""><nav class="wf-menu__nav">${items
    .map(
      (item) =>
        `<button class="${item === 'Wiedza' ? 'is-new' : ''}" ${item === 'Wiedza' ? 'data-menu-open' : 'disabled'}>${item}</button>`,
    )
    .join('')}</nav></div>`;
}

function menuScreen(size) {
  const width = Math.min(1320, size.width - 96);
  const height = size.height - 112;
  const x = Math.round((size.width - width) / 2);
  return `<div class="wf-menu"><img class="wf-menu__shot wf-menu__shot--dim" src="/review/menu.png" alt="">
    <button class="wf-menu__back" data-menu-back>‹ Menu główne</button>
    ${chrome('Wiedza', knowledgeBody(), `left:${x}px;top:72px;width:${width}px;height:${height}px`, 'kn-window--menu')}</div>`;
}

function renderStory() {
  const list = SCREENS.map(
    (s, i) =>
      `<button class="wf-story__item" aria-current="${state.screen === s.id}" data-screen="${s.id}"><i>${i + 1}</i>${esc(s.title)}</button>`,
  ).join('');
  const frames = FRAMES.map(
    (f) => `<option value="${f.id}" ${state.frame === f.id ? 'selected' : ''}>${f.name}</option>`,
  ).join('');
  document.querySelector('#story').innerHTML =
    `<strong>Wiedza · makiety</strong><div class="wf-story">${list}</div><label class="wf-size">Ekran <select data-frame>${frames}</select></label>`;
}

function renderNotes() {
  const screen = SCREENS.find((s) => s.id === state.screen);
  document.querySelector('#notes').innerHTML = `<h2>${esc(screen.title)}</h2><p>${esc(screen.intent)}</p>
    <h3>Do oceny</h3><ul>${screen.judge.map((j) => `<li>${esc(j)}</li>`).join('')}</ul>
    ${screen.data === undefined ? '' : `<h3>Skąd dane</h3><ul>${screen.data.map((j) => `<li>${esc(j)}</li>`).join('')}</ul>`}`;
}

function fitFrame() {
  const frame = document.querySelector('#frame');
  const stage = document.querySelector('#stage');
  const size = FRAMES.find((f) => f.id === state.frame);
  const scale = Math.min(stage.clientWidth / size.width, stage.clientHeight / size.height, MAX_STAGE_SCALE);
  frame.style.left = `${Math.max(0, (stage.clientWidth - size.width * scale) / 2)}px`;
  frame.style.width = `${size.width}px`;
  frame.style.height = `${size.height}px`;
  frame.style.transform = `scale(${scale})`;
}

let shownEntry = 'null';

function render() {
  const keep = new Map();
  for (const node of document.querySelectorAll('[data-keep-scroll]'))
    keep.set(node.dataset.keepScroll, [node.scrollLeft, node.scrollTop]);
  const size = FRAMES.find((f) => f.id === state.frame);
  const focused = document.activeElement?.matches?.('[data-search]') ?? false;
  const surfaces = { game: gameFrame, menuHome, menuScreen, plan: () => PLAN_PAGE };
  const surface = surfaces[state.surface](size);
  document.querySelector('#frame').innerHTML =
    `<div class="on-hud" style="--on-surface:url('/app/assets/ui/foundation/surface.png');--on-icons:url('/app/assets/ui/foundation/icons.png')">${surface}</div>`;
  for (const node of document.querySelectorAll('[data-keep-scroll]')) {
    const at = keep.get(node.dataset.keepScroll);
    if (at !== undefined) [node.scrollLeft, node.scrollTop] = at;
  }
  if (focused) {
    const input = document.querySelector('[data-search]');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
  const picked = JSON.stringify(state.entry);
  if (picked !== shownEntry) {
    shownEntry = picked;
    document
      .querySelector(
        '.kn-map .is-selected, .kn-list .is-selected, .kn-tiers .is-selected, .kn-jobs .is-selected',
      )
      ?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }
  renderStory();
  renderNotes();
  fitFrame();
}

function showScreen(id) {
  const screen = SCREENS.find((s) => s.id === id);
  past.length = 0;
  future.length = 0;
  const frame = state.screen === 'small' ? base.frame : state.frame;
  state = { ...base, frame, ...NAV_DEFAULT, screen: id, ...screen.state };
  render();
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, [data-frame]');
  if (target === null || target.disabled) return;
  const d = target.dataset;
  if (d.screen !== undefined) return showScreen(d.screen);
  if (d.tab !== undefined) return go({ tab: d.tab, entry: d.tab === state.tab ? state.entry : null });
  if (d.lens !== undefined) return go({ lens: d.lens, entry: null, onlyChain: false });
  if (d.lane !== undefined) {
    const map = document.querySelector('.kn-map');
    const lane = document.querySelector(`[data-lane-at="${d.lane}"]`);
    if (map !== null && lane !== null) map.scrollTop = lane.offsetTop * state.zoom;
    return undefined;
  }
  if (d.zoom !== undefined) {
    state = { ...state, zoom: Number(d.zoom) };
    return render();
  }
  if (d.pick !== undefined) {
    const entry = parseEntry(d.pick);
    if (state.tab === 'encyclopedia') return go({ entry });
    return go({ entry, onlyChain: entry.kind === 'good' });
  }
  if (d.go !== undefined) {
    const entry = parseEntry(d.go);
    if (state.tab === 'production')
      return go({
        entry,
        onlyChain: entry.kind === 'good',
        lens: entry.kind === 'good' ? 'goods' : entry.kind === 'building' ? 'buildings' : 'jobs',
      });
    return go({ tab: 'encyclopedia', category: categoryOf(entry), entry });
  }
  if (d.open !== undefined) {
    const entry = parseEntry(d.open);
    return go({ tab: 'encyclopedia', category: categoryOf(entry), entry });
  }
  if (d.show !== undefined) {
    const [tab, kind, id] = d.show.split(':');
    return go({ tab, lens: 'goods', entry: { kind, id }, onlyChain: true });
  }
  if (d.category !== undefined) return go({ category: d.category, entry: null });
  if (d.table !== undefined) return go({ tab: 'tables', table: d.table });
  if (d.article !== undefined) return go({ tab: 'mechanics', article: d.article });
  if (d.howto !== undefined) return go({ howto: d.howto });
  if (d.toggle !== undefined) {
    state = { ...state, onlyChain: !state.onlyChain };
    return render();
  }
  if (d.matrix !== undefined) {
    const [name, value] = d.matrix.split(':');
    state = { ...state, matrix: { ...state.matrix, [name]: name === 'metric' ? value : Number(value) } };
    return render();
  }
  if (d.searchHit !== undefined) return go(INDEX[Number(d.searchHit)].go);
  if (d.back !== undefined && past.length > 0) {
    future.push(navOf(state));
    state = { ...state, ...past.pop() };
    return render();
  }
  if (d.forward !== undefined && future.length > 0) {
    past.push(navOf(state));
    state = { ...state, ...future.pop() };
    return render();
  }
  if (d.menuOpen !== undefined) {
    state = { ...state, surface: 'menuScreen', mode: 'menu' };
    return render();
  }
  if (d.menuBack !== undefined) {
    state = { ...state, surface: 'menuHome' };
    return render();
  }
  return undefined;
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.matches('[data-search]')) {
    state = { ...state, query: target.value };
    render();
  }
  if (target.matches('[data-tribe]')) {
    state = { ...state, tribe: Number(target.value) };
    render();
  }
  if (target.matches('[data-frame]')) {
    state = { ...state, frame: target.value };
    render();
  }
  if (target.matches('[data-only-map]')) {
    state = { ...state, onlyMap: target.checked, mode: target.checked ? 'game' : 'free' };
    render();
  }
  if (target.matches('[data-matrix-check]')) {
    state = { ...state, matrix: { ...state.matrix, [target.dataset.matrixCheck]: target.checked } };
    render();
  }
});

window.addEventListener('resize', fitFrame);
showScreen('plan');
