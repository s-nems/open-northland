import { fetchJsonOrNull } from '../content/net.js';
import { SCENES } from '../scenes/index.js';
import { el, pageInnerStyle, pageRootStyle, pageSection } from '../view/overlay.js';

/**
 * The main MENU — the default landing when the app boots with no entry flag. It replaces "remember the
 * right `?scene=` / `?anim` / `?map=` string" with clickable cards: pick an acceptance scene, the
 * animation gallery, or a decoded map, and the menu navigates the page into that entry
 * (`window.location.search = …`, which re-dispatches through `main.ts`). Plain DOM, app-layer only —
 * no Pixi, no sim; it draws a full-viewport panel OVER the (empty) canvas.
 *
 * The scene list is the SCENES registry itself, so adding an acceptance scene automatically adds its
 * menu card (title + summary) — the same single-source-of-truth `?scene=<id>` links the scene test and
 * the browser share. The map list is fetched from the dev server's `/maps-index` route (one entry per
 * gitignored `content/maps/<id>.json`, joined with the pipeline's optional name/description/minimap
 * sidecars — see {@link MapIndexEntry}); absent `content/` simply shows a hint instead of map cards.
 */

/** The menu's page-shell knobs (shared shell in view/overlay.ts). */
const ROOT_STYLE = pageRootStyle(40, 15);
const INNER_STYLE = pageInnerStyle(960);

const GRID_STYLE = [
  'display:grid',
  'grid-template-columns:repeat(auto-fill,minmax(240px,1fr))',
  'gap:12px',
].join(';');

const CARD_STYLE = [
  'cursor:pointer',
  'display:flex',
  'flex-direction:column',
  'gap:4px',
  'text-align:left',
  'box-sizing:border-box',
  'padding:14px 16px',
  'background:#2a2016',
  'color:#e8dcc8',
  'border:1px solid #5a4a36',
  'border-radius:8px',
  'transition:background 0.12s,border-color 0.12s',
  'font:inherit',
].join(';');

/**
 * The map cards' minimap thumbnail. The decoded originals are cropped to the real map pixels (the
 * pipeline keys out the 350×160 canvas' magenta filler), so aspect ratios vary per map — a fixed
 * card-wide box with `contain` keeps the grid rows even and letterboxes on the card background.
 */
const THUMB_STYLE = [
  'display:block',
  'width:100%',
  'aspect-ratio:350/160',
  'object-fit:contain',
  'border-radius:5px',
  'background:#1c1610',
].join(';');

/** A clickable card that navigates the page to `search` (e.g. `?scene=sandbox`) on click. */
function card(title: string, subtitle: string, search: string, thumbnail?: string): HTMLButtonElement {
  const b = el('button', CARD_STYLE);
  if (thumbnail !== undefined) {
    const img = el('img', THUMB_STYLE);
    img.src = thumbnail;
    img.alt = ''; // decorative — the card's title names the map
    img.loading = 'lazy'; // dozens of maps; fetch thumbnails as they scroll in
    b.append(img);
  }
  b.append(
    el('span', 'font-weight:700;font-size:15px', title),
    el('span', 'opacity:0.78;font-size:13px;line-height:1.4', subtitle),
  );
  b.addEventListener('mouseenter', () => {
    b.style.background = '#3a2c1c';
    b.style.borderColor = '#8a6f4c';
  });
  b.addEventListener('mouseleave', () => {
    b.style.background = '#2a2016';
    b.style.borderColor = '#5a4a36';
  });
  b.addEventListener('click', () => {
    window.location.search = search;
  });
  return b;
}

/** A titled section wrapping a grid of `cards` (the shared page section over a card grid). */
function section(title: string, cards: readonly HTMLElement[]): HTMLElement {
  const grid = el('div', GRID_STYLE);
  for (const c of cards) grid.append(c);
  return pageSection(title, [grid]);
}

/**
 * One `/maps-index` entry: a decoded map's stem id plus the pipeline's optional menu sidecars — the
 * original's display name/description (the map folder's `text/<lang>/strings.*`) and whether a decoded
 * minimap thumbnail is served at `/maps/<id>.png`. Fields degrade per map: a sidecar-less map is just
 * its id (the card then shows the stem + a generic subtitle, like before the sidecars existed).
 */
export interface MapIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly minimap: boolean;
}

/**
 * Narrows the `/maps-index` response (unknown JSON) to the entries the menu can render. Per-entry
 * tolerant: anything without a string `id` is dropped; wrong-typed optional fields are ignored rather
 * than dropping the map. Exported for the headless unit test.
 */
export function parseMapsIndex(data: unknown): readonly MapIndexEntry[] {
  if (!Array.isArray(data)) return [];
  const entries: MapIndexEntry[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name, description, minimap } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') continue;
    entries.push({
      id,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof description === 'string' ? { description } : {}),
      minimap: minimap === true,
    });
  }
  return entries;
}

/** The decoded-map list the dev server exposes at `/maps-index` (gitignored `content/maps/*`). */
async function loadMapList(): Promise<readonly MapIndexEntry[]> {
  return parseMapsIndex(await fetchJsonOrNull<unknown>('/maps-index'));
}

export async function renderMenu(_canvas: HTMLCanvasElement, _params: URLSearchParams): Promise<void> {
  const root = el('div', ROOT_STYLE);
  const inner = el('div', INNER_STYLE);

  inner.append(
    el('div', 'font-weight:700;font-size:28px;letter-spacing:0.02em', 'OpenNorthland'),
    el(
      'div',
      'opacity:0.75;margin-top:4px;font-size:14px',
      'Wybierz scenę lub tryb podglądu. (To menu zastępuje ręczne wpisywanie parametrów ?scene=… w URL.)',
    ),
  );

  // Acceptance scenes — one card per SCENES entry (the same registry the headless test + `?scene=` share).
  inner.append(
    section(
      'Sceny akceptacyjne',
      SCENES.map((s) => card(s.title, s.summary, `?scene=${encodeURIComponent(s.id)}`)),
    ),
  );

  // Standing preview modes.
  inner.append(
    section('Tryby podglądu', [
      card('Animacje postaci', 'Galeria wikingów: każdy look chodzi, wybór kierunku i postaci.', '?anim'),
      card(
        'Podgląd dźwięków',
        'Odsłuchaj każdy dźwięk: akcje (rąbanie, budowa), głosy (M/K/dzieci), jingle, ambient.',
        '?sounds',
      ),
      card(
        'Galeria ikon',
        'Przeglądaj każdą klatkę zdekodowanych atlasów (GUI, dobra, obiekty, domy), etykietowaną numerem klatki.',
        '?icons',
      ),
    ]),
  );

  // Decoded maps (gitignored content/) — filled async so a missing content/ shows a hint, not an empty grid.
  const mapsBody = el('div', '');
  inner.append(pageSection('Mapy (import oryginalnych map)', [mapsBody]));

  root.append(inner);
  document.body.append(root);

  const maps = await loadMapList();
  if (maps.length === 0) {
    mapsBody.style.cssText = 'opacity:0.7;font-size:13px;line-height:1.5';
    mapsBody.textContent =
      'Brak zdekodowanych map w content/maps/. Uruchom `npm run pipeline` na posiadanej kopii gry, aby je wygenerować (są gitignore).';
    return;
  }
  const grid = el('div', GRID_STYLE);
  for (const map of maps) {
    grid.append(
      card(
        map.name ?? map.id,
        map.description ?? 'Oryginalna mapa: teren 1:1 + obiekty (drzewa, kamienie, fale).',
        `?map=${encodeURIComponent(map.id)}`,
        map.minimap ? `/maps/${encodeURIComponent(map.id)}.png` : undefined,
      ),
    );
  }
  mapsBody.append(grid);
}
