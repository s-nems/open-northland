import { dismissBootProgress } from '../../view/boot-progress.js';
import { galleryBuildingTribes } from './building-geometry.js';
import { type GalleryEntry, galleryEntries, loadGalleryCatalog } from './catalog.js';
import { button, element, galleryControls } from './controls.js';
import { renderHudFoundation } from './hud-foundation.js';
import { galleryMapDestination } from './locations.js';
import { createGalleryPreview } from './preview.js';
import { gallerySelection, tabOf } from './selection.js';
import { GALLERY_COMPARISON_LIMIT, type GalleryTab, galleryQuery, readGalleryState } from './state.js';
import { thumbnail } from './thumbnail.js';
import './gallery.css';

/** The board opens at the neutral scale; the tab's slider covers the shipped range. */
const HUD_FOUNDATION_SCALE = 1;

async function deliveryLabel(): Promise<string> {
  if (!import.meta.env.DEV) return 'Published assets';
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}__art-preview.json`);
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json'))
      return 'Published assets';
    const data: unknown = await response.json();
    if (
      typeof data === 'object' &&
      data !== null &&
      'id' in data &&
      typeof data.id === 'string' &&
      'digest' in data &&
      typeof data.digest === 'string'
    )
      return `Candidate: ${data.id} · ${data.digest.slice(0, 12)}`;
  } catch {
    return 'Delivery status unavailable';
  }
  return 'Published assets';
}

export async function renderArtGallery(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const catalog = loadGalleryCatalog();
  const entries = galleryEntries(catalog);
  let state = readGalleryState(params);
  const root = element('section');
  root.className = 'art-gallery';
  root.setAttribute('aria-label', 'Own asset gallery');
  const header = element('header');
  header.append(element('h1', 'Own asset gallery'), element('p', await deliveryLabel()));
  const nav = element('nav');
  nav.setAttribute('aria-label', 'Asset categories');
  const tabs: readonly (readonly [GalleryTab, string])[] = [
    ['animations', 'Animations'],
    ['buildings', 'Buildings'],
    ['terrain', 'Terrain & tilesets'],
    ['goods', 'Goods & icons'],
    ['hud', 'HUD foundation'],
  ];
  const body = element('div');
  body.className = 'body';
  const aside = element('aside');
  const search = element('input');
  search.type = 'search';
  search.placeholder = 'Find an asset…';
  search.setAttribute('aria-label', 'Find an asset');
  search.value = state.q;
  const list = element('div');
  list.className = 'asset-list';
  const count = element('p');
  const kindFilter = element('select');
  kindFilter.setAttribute('aria-label', 'Terrain category');
  for (const [value, label] of [
    ['all', 'All terrain assets'],
    ['material', 'Materials & tilesets'],
    ['prop', 'Plants & rocks'],
  ]) {
    const option = element('option', label);
    option.value = value ?? 'all';
    kindFilter.append(option);
  }
  kindFilter.value = state.terrainKind;
  kindFilter.addEventListener('change', () => {
    state.terrainKind =
      kindFilter.value === 'prop' ? 'prop' : kindFilter.value === 'material' ? 'material' : 'all';
    save();
    renderList();
  });
  aside.append(search, kindFilter, count, list);
  const main = element('main');
  const detail = element('div');
  detail.className = 'detail';
  const viewport = element('div');
  viewport.className = 'viewport';
  const previewCanvas = element('canvas');
  viewport.append(previewCanvas);
  const status = element('p', 'Loading previews…');
  status.className = 'status';
  status.setAttribute('role', 'status');
  main.append(detail, viewport, status);
  body.append(aside, main);
  header.append(nav);
  root.append(header, body);
  document.body.append(root);
  canvas.hidden = true;
  dismissBootProgress();
  const preview = await createGalleryPreview(previewCanvas, {
    soilImage: catalog.soilImage,
    reference: catalog.characters[0],
    buildingTribes: galleryBuildingTribes(catalog.buildings.map((entry) => entry.manifest)),
  });
  let revision = 0;
  let shownAssets = state.assets;
  function save(): void {
    window.history.replaceState(null, '', galleryQuery(state));
  }
  function update(captureClock = false): void {
    if (captureClock) state.time = preview.time();
    save();
    viewport.className = `viewport ${state.background}`;
    preview.update(state);
    // A panel binds the original body when built, so switching assets rebuilds the view.
    if (state.assets !== shownAssets) render();
  }
  function visibleEntries(): readonly GalleryEntry[] {
    return entries.filter(
      (entry) =>
        tabOf(entry) === state.tab &&
        (state.tab !== 'terrain' || state.terrainKind === 'all' || entry.kind === state.terrainKind) &&
        `${entry.name} ${entry.id}`.toLowerCase().includes(state.q.toLowerCase()),
    );
  }
  function renderList(): void {
    kindFilter.hidden = state.tab !== 'terrain';
    kindFilter.value = state.terrainKind;
    list.replaceChildren();
    const visible = visibleEntries();
    count.textContent = `${visible.length} / ${entries.filter((entry) => tabOf(entry) === state.tab).length} assets`;
    for (const entry of visible) {
      const card = button('', () => {
        state.asset = entry.id;
        render();
      });
      card.className = 'asset-card';
      card.setAttribute('aria-pressed', String(entry.id === state.asset));
      const image = thumbnail(entry);
      const name = element('span', entry.name);
      name.className = 'asset-name';
      name.append(element('small', entry.id));
      card.append(image, name);
      list.append(card);
    }
    if (!visible.length) list.append(element('p', 'No matching assets.'));
  }
  function render(): void {
    const request = ++revision;
    nav.replaceChildren();
    for (const [tab, title] of tabs) {
      const tabButton = button(title, () => {
        state.tab = tab;
        state.asset = '';
        state.q = '';
        search.value = '';
        render();
      });
      tabButton.setAttribute('aria-pressed', String(state.tab === tab));
      nav.append(tabButton);
    }
    body.classList.toggle('body--wide', state.tab === 'hud');
    if (state.tab === 'hud') {
      aside.hidden = true;
      status.textContent = 'HUD foundation primitives; drag the scale to check the shipped range.';
      renderHudFoundation(main, HUD_FOUNDATION_SCALE, status);
      save();
      return;
    }
    aside.hidden = false;
    if (!main.contains(viewport)) main.replaceChildren(detail, viewport, status);
    const { selected, compared, missing } = gallerySelection(entries, state);
    detail.replaceChildren();
    if (!selected) {
      const message = state.asset
        ? `Asset unavailable in this category or delivery: ${state.asset}`
        : 'No delivered assets match these filters.';
      detail.append(element('p', message));
      status.textContent = message;
      void preview.show([]);
      renderList();
      save();
      return;
    }
    state.asset = selected.id;
    const shown = [selected, ...compared];
    if (missing.length) detail.append(element('p', `Comparison assets unavailable: ${missing.join(', ')}`));
    detail.append(element('h2', selected.name));
    const destination = galleryMapDestination(
      selected,
      selected.kind === 'character' ? selected.manifest.id : undefined,
    );
    const map = element('a', `Open map · ${destination.label}`);
    map.href = destination.href;
    map.target = '_blank';
    map.rel = 'noopener';
    detail.append(map, element('small', destination.note));
    const actions = element('div');
    actions.className = 'pins';
    const pinned = state.compare.includes(selected.id);
    const pin = button(pinned ? 'Unpin comparison' : 'Pin for comparison', () => {
      state.compare = pinned
        ? state.compare.filter((id) => id !== selected.id)
        : [...state.compare, selected.id].slice(-GALLERY_COMPARISON_LIMIT);
      render();
    });
    actions.append(
      pin,
      button('Copy view link', () => {
        update(true);
        if (!navigator.clipboard) {
          status.textContent = 'Copy the address from your browser.';
          return;
        }
        void navigator.clipboard
          .writeText(window.location.href)
          .then(() => {
            status.textContent = 'View link copied.';
          })
          .catch(() => {
            status.textContent = 'Copy the address from your browser.';
          });
      }),
    );
    for (const id of state.compare) {
      const entry = entries.find((item) => item.id === id);
      if (entry)
        actions.append(
          button(`× ${entry.name}`, () => {
            state.compare = state.compare.filter((value) => value !== id);
            render();
          }),
        );
    }
    detail.append(actions, galleryControls(selected, shown, state, update));
    detail.append(
      element(
        'small',
        selected.kind === 'building'
          ? 'Shared world scale; civilian reference at each entrance. Footprint & signs draws the sim lattice, walk-block (red), build-block (orange), door (green) and the sign post with its badges or construction stand; Assets swaps in the original body over the same geometry.'
          : selected.kind === 'material'
            ? 'Generated runtime tiles; transparent areas expose transition coverage. Check the linked map for elevation and actual placement.'
            : 'Compare at the same world scale. Missing clips are labelled in the preview.',
      ),
    );
    renderList();
    shownAssets = state.assets;
    update();
    status.classList.remove('error');
    status.textContent = 'Loading previews…';
    void preview
      .show(shown)
      .then((notes) => {
        if (request !== revision) return;
        preview.update(state);
        status.textContent = [
          `${shown.map((entry) => entry.name).join(' · ')}, zoom ×${state.zoom}`,
          ...notes,
        ].join(' · ');
      })
      .catch((error: unknown) => {
        if (request !== revision) return;
        status.classList.add('error');
        status.textContent = `Preview unavailable: ${error instanceof Error ? error.message : String(error)}`;
      });
  }
  search.addEventListener('input', () => {
    state.q = search.value;
    save();
    renderList();
  });
  window.addEventListener('popstate', () => {
    state = readGalleryState(new URLSearchParams(window.location.search));
    search.value = state.q;
    render();
  });
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) preview.destroy();
  });
  render();
}
