import { data, esc, goodIcon } from './model.js';
import { PLAN_PAGE, SCREENS } from './screens.js';
import { spotlight } from './tree.js';
import { encyclopediaView, placeOf } from './view-encyclopedia.js';
import { ARTICLE_LIST, mechanicsView } from './view-mechanics.js';
import { buildingsTree, goodsTree, relateBuilding, relateGood } from './view-trees.js';

const TABS = [
  { id: 'goods', name: 'Towary' },
  { id: 'buildings', name: 'Budynki' },
  { id: 'encyclopedia', name: 'Encyklopedia' },
  { id: 'mechanics', name: 'Mechaniki' },
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
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.3;
const ZOOM_STEP = 0.05;

const base = {
  screen: 'overview',
  surface: 'game',
  mode: 'game',
  frame: 'wide',
  tribe: 1,
  onlyMap: true,
  query: '',
  zoom: { goods: 1, buildings: 1 },
  matrix: { metric: 'damage', direction: 100, hits: 0, strength: false, defense: false, heroes: false },
};
const NAV_DEFAULT = { tab: 'goods', entry: null, category: 'goods', article: 'tools', show: null };
let state = { ...base, ...NAV_DEFAULT };
/** Where the player came from. One back button covers every link, tab and search hit. */
const past = [];

const navOf = (s) => ({
  tab: s.tab,
  entry: s.entry,
  category: s.category,
  article: s.article,
  show: s.show,
});

function go(change) {
  past.push(navOf(state));
  state = { ...state, query: '', show: null, ...change };
  render();
}

function parseEntry(key) {
  const at = key.indexOf(':');
  return { kind: key.slice(0, at), id: key.slice(at + 1) };
}

const openEntry = (entry) => go({ tab: 'encyclopedia', ...placeOf(entry) });

function searchIndex() {
  const pages = [];
  for (const g of data.goods)
    pages.push({ group: 'Towary', name: g.name, entry: { kind: 'good', id: g.id }, picture: goodIcon(g) });
  for (const b of data.buildings)
    pages.push({ group: 'Budynki', name: b.name, entry: { kind: 'building', id: b.id } });
  for (const j of data.jobs) pages.push({ group: 'Zawody', name: j.name, entry: { kind: 'job', id: j.id } });
  for (const a of data.animals)
    pages.push({ group: 'Zwierzęta', name: a.name, entry: { kind: 'animal', id: String(a.tribe) } });
  for (const a of ARTICLE_LIST) {
    pages.push({ group: 'Mechaniki', name: a.name, article: a.id });
    for (const block of a.blocks) {
      if (block.h !== undefined) {
        pages.push({ group: 'Mechaniki', name: `${a.name}: ${block.h}`, article: a.id });
      }
    }
  }
  return pages;
}
const INDEX = searchIndex();
const fold = (text) =>
  text.toLocaleLowerCase('pl').normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ł', 'l');

function searchView(query) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hits = INDEX.filter((page) => words.every((w) => fold(page.name).includes(w)));
  if (hits.length === 0) {
    return `<div class="on-parchment kn-page kn-search-empty"><h3>Nic nie znaleziono</h3><p>Szukamy w nazwach towarów, budynków, zawodów, zwierząt i mechanik. Spróbuj krótszego słowa.</p></div>`;
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
    goods: goodsTree,
    buildings: buildingsTree,
    encyclopedia: encyclopediaView,
    mechanics: mechanicsView,
  };
  const main = state.query.trim() === '' ? views[state.tab](state) : searchView(state.query);
  return `<div class="kn-tabs on-tabs" role="tablist">${tabs}</div>
    <div class="kn-tool">
      <button class="on-button on-button--rounded kn-back" data-back ${past.length === 0 ? 'disabled' : ''}>‹ Wróć</button>
      <span class="kn-tool__gap"></span>
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

/** Scroll offsets by name, kept past the view that owned them, so going back lands where the player was. */
const scrolls = new Map();

function rememberScrolls() {
  for (const node of document.querySelectorAll('[data-keep-scroll]')) {
    scrolls.set(node.dataset.keepScroll, [node.scrollLeft, node.scrollTop]);
  }
}

const relateOf = (key) => (key.startsWith('good:') ? relateGood(key) : relateBuilding(key));

function render() {
  rememberScrolls();
  const size = FRAMES.find((f) => f.id === state.frame);
  const focused = document.activeElement?.matches?.('[data-search]') ?? false;
  const surfaces = { game: gameFrame, menuHome, menuScreen, plan: () => PLAN_PAGE };
  const surface = surfaces[state.surface](size);
  document.querySelector('#frame').innerHTML =
    `<div class="on-hud" style="--on-surface:url('/app/assets/ui/foundation/surface.png');--on-icons:url('/app/assets/ui/foundation/icons.png')">${surface}</div>`;
  for (const node of document.querySelectorAll('[data-keep-scroll]')) {
    const at = scrolls.get(node.dataset.keepScroll);
    if (at !== undefined) [node.scrollLeft, node.scrollTop] = at;
  }
  if (focused) {
    const input = document.querySelector('[data-search]');
    input?.focus();
    input?.setSelectionRange(input.value.length, input.value.length);
  }
  document.querySelector('.kn-list .is-selected')?.scrollIntoView({ block: 'nearest' });
  renderStory();
  renderNotes();
  fitFrame();
  const view = document.querySelector('.kn-treeview');
  if (view !== null && state.show !== null) {
    view.querySelector(`[data-node="${state.show}"]`)?.scrollIntoView({ block: 'center' });
    spotlight(view, state.show, relateOf);
  }
}

function showScreen(id) {
  const screen = SCREENS.find((s) => s.id === id);
  past.length = 0;
  scrolls.clear();
  const frame = state.screen === 'small' ? base.frame : state.frame;
  state = { ...base, frame, ...NAV_DEFAULT, screen: id, ...screen.state };
  render();
  if (screen.point !== undefined) {
    const view = document.querySelector('.kn-treeview');
    view?.querySelector(`[data-node="${screen.point}"]`)?.scrollIntoView({ block: 'center' });
    if (view !== null) spotlight(view, screen.point, relateOf);
  }
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('button, [data-frame]');
  if (target === null || target.disabled) return;
  const d = target.dataset;
  if (d.screen !== undefined) return showScreen(d.screen);
  if (d.tab !== undefined) return go({ tab: d.tab });
  if (d.pick !== undefined) return go({ entry: parseEntry(d.pick) });
  if (d.go !== undefined) return openEntry(parseEntry(d.go));
  if (d.show !== undefined) return go({ tab: 'goods', show: d.show });
  if (d.category !== undefined) return go({ category: d.category, entry: null });
  if (d.article !== undefined) return go({ tab: 'mechanics', article: d.article });
  if (d.matrix !== undefined) {
    const [name, value] = d.matrix.split(':');
    state = { ...state, matrix: { ...state.matrix, [name]: name === 'metric' ? value : Number(value) } };
    return render();
  }
  if (d.searchHit !== undefined) {
    const hit = INDEX[Number(d.searchHit)];
    return hit.article === undefined ? openEntry(hit.entry) : go({ tab: 'mechanics', article: hit.article });
  }
  if (d.back !== undefined && past.length > 0) {
    state = { ...state, query: '', ...past.pop() };
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

/** Pointing at a card lights its chain. A card shown from an entry stays lit until the pointer really
 *  moves: a re-render under a still pointer fires over events, never a move. */
let pointed = null;
document.addEventListener('pointermove', (event) => {
  const view = event.target.closest?.('.kn-treeview');
  if (view === null || view === undefined) return;
  const key = event.target.closest('[data-node]')?.dataset.node ?? null;
  if (key === pointed) return;
  pointed = key;
  spotlight(view, key, relateOf);
});

function setZoom(id, value) {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value / ZOOM_STEP) * ZOOM_STEP));
  state = { ...state, zoom: { ...state.zoom, [id]: zoom } };
  const view = document.querySelector('.kn-treeview');
  view.querySelector('.kn-treezoom').style.zoom = String(zoom);
  view.querySelector('.kn-zoom input').value = String(Math.round(zoom * 100));
  view.querySelector('.kn-zoom output').textContent = `${Math.round(zoom * 100)}%`;
}

document.addEventListener(
  'wheel',
  (event) => {
    const view = event.target.closest?.('.kn-treeview');
    if (view === null || view === undefined || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    const id = view.dataset.tree;
    setZoom(id, state.zoom[id] + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  },
  { passive: false },
);

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
  if (target.matches('[data-zoom]')) setZoom(target.dataset.zoom, Number(target.value) / 100);
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
