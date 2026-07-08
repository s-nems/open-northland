import { SCENES } from '../scenes/index.js';
import { el } from '../view/overlay.js';

/**
 * The main MENU — the default landing when the app boots with no entry flag. It replaces "remember the
 * right `?scene=` / `?anim` / `?map=` string" with clickable cards: pick an acceptance scene, the live
 * sandbox, the animation gallery, or a decoded map, and the menu navigates the page into that entry
 * (`window.location.search = …`, which re-dispatches through `main.ts`). Plain DOM, app-layer only —
 * no Pixi, no sim; it draws a full-viewport panel OVER the (empty) canvas.
 *
 * The scene list is the SCENES registry itself, so adding an acceptance scene automatically adds its
 * menu card (title + summary) — the same single-source-of-truth `?scene=<id>` links the scene test and
 * the browser share. The map list is fetched from the dev server's `/maps-index` route (the gitignored
 * `content/maps/*.json` stems); absent `content/` simply shows a hint instead of map cards.
 */

const ROOT_STYLE = [
  'position:fixed',
  'inset:0',
  'overflow-y:auto',
  'box-sizing:border-box',
  'padding:40px 20px 64px',
  'background:radial-gradient(120% 80% at 50% 0%,#241b12 0%,#160f0a 70%)',
  'color:#e8dcc8',
  'font:15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
  'z-index:100',
].join(';');

const INNER_STYLE = ['max-width:960px', 'margin:0 auto'].join(';');

const SECTION_TITLE_STYLE = [
  'font-weight:700',
  'font-size:14px',
  'letter-spacing:0.08em',
  'text-transform:uppercase',
  'opacity:0.7',
  'margin:28px 0 12px',
  'border-bottom:1px solid #5a4a36',
  'padding-bottom:6px',
].join(';');

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

/** A clickable card that navigates the page to `search` (e.g. `?scene=sandbox`) on click. */
function card(title: string, subtitle: string, search: string): HTMLButtonElement {
  const b = el('button', CARD_STYLE);
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

/** A titled section wrapping a grid of `cards`. */
function section(title: string, cards: readonly HTMLElement[]): HTMLElement {
  const wrap = el('div', '');
  wrap.append(el('div', SECTION_TITLE_STYLE, title));
  const grid = el('div', GRID_STYLE);
  for (const c of cards) grid.append(c);
  wrap.append(grid);
  return wrap;
}

/** The decoded-map stems the dev server exposes at `/maps-index` (gitignored `content/maps/*.json`). */
async function loadMapList(): Promise<readonly string[]> {
  try {
    const res = await fetch('/maps-index');
    if (!res.ok) return [];
    const data: unknown = await res.json();
    return Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function renderMenu(_canvas: HTMLCanvasElement, _params: URLSearchParams): Promise<void> {
  const root = el('div', ROOT_STYLE);
  const inner = el('div', INNER_STYLE);

  inner.append(
    el('div', 'font-weight:700;font-size:28px;letter-spacing:0.02em', 'Vinland'),
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
      card('Podgląd na żywo', 'Pionowy przekrój napędzany pętlą symulacji — świat w ruchu.', '?live'),
      card('Animacje postaci', 'Galeria wikingów: każdy look chodzi, wybór kierunku i postaci.', '?anim'),
      card(
        'Podgląd dźwięków',
        'Odsłuchaj każdy dźwięk: akcje (rąbanie, budowa), głosy (M/K/dzieci), jingle, ambient.',
        '?sounds',
      ),
    ]),
  );

  // Decoded maps (gitignored content/) — filled async so a missing content/ shows a hint, not an empty grid.
  const mapsWrap = el('div', '');
  mapsWrap.append(el('div', SECTION_TITLE_STYLE, 'Mapy (import oryginalnych map)'));
  const mapsBody = el('div', '');
  mapsWrap.append(mapsBody);
  inner.append(mapsWrap);

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
  for (const stem of maps) {
    grid.append(
      card(
        stem,
        'Oryginalna mapa: teren 1:1 + obiekty (drzewa, kamienie, fale).',
        `?map=${encodeURIComponent(stem)}`,
      ),
    );
  }
  mapsBody.append(grid);
}
