import {
  AnimationGallery,
  GALLERY_DIRS,
  type GalleryCellSpec,
  type GalleryClip,
  type GalleryDirection,
  type SpriteAtlas,
  type SpriteLayer,
  clipDirs,
  createWindowPixiApp,
} from '@vinland/render';
import { MIN_ZOOM, createCameraController, floatParam } from './camera.js';
import { type BobSeqRow, MissingAtlasError, loadBodyClips, loadGalleryLayers } from './real-sprites.js';
import {
  DEFAULT_CHARACTER_PALETTE,
  VIKING_CHARACTERS,
  type VikingCharacter,
  characterStems,
  findCharacter,
  headLabel,
  pickWalkRow,
} from './viking-roster.js';

/**
 * The `?anim` entry — the character **animation gallery**, the animation twin of the `?scene=all-buildings`
 * catalog. It plays the extracted `[bobseq]` of a viking body straight from the atlas so a human can
 * validate that each animation decodes, cycles, and (for the locomotion clips) reads correctly in all 8
 * directions. A pure viewer: no sim, DOM + wall-clock are fine here (`app` boundary).
 *
 * Two axes over the FULL viking roster ({@link VIKING_CHARACTERS}):
 *  - `?char=<id>` picks the character — civilian / **warrior** (its own broadsword / sword / bow / spear /
 *    bare-handed combat set) / woman / child / baby. Changing it reloads that body + head atlases.
 *  - `?view=anim|heads` picks the layout — `anim` (default) plays every sequence of the body with its
 *    default head; `heads` plays the plain walk once per head LOOK, the montage of all faces/hats.
 *
 * Also: `?dir=full|0..7` (the global facing every clip plays; live, no reload), `?cols=N`, `?filter=<substr>`
 * (narrows sequences by name / looks by head), `?zoom`, `?speed`. Real decoded graphics are required — a
 * checkout without `content/` shows a "run the pipeline" message instead of crashing.
 */

const DEFAULT_COLUMNS = 8;
/** Screen margin (px) the grid's top-left starts at under the initial camera. */
const GRID_MARGIN = 40;
/** The base locomotion sequence whose head the empty-headed carry variants borrow (see clip build). */
const WALK_SEQ = 'human_man_generic_walk';

/** Panel chrome shared with the scene overlay's look (kept local so `app` files stay independent). */
const PANEL_STYLE = [
  'position:fixed',
  'top:12px',
  'right:12px',
  'width:300px',
  'box-sizing:border-box',
  'padding:12px 14px',
  'background:rgba(20,16,12,0.92)',
  'color:#e8dcc8',
  'font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
  'border:1px solid #5a4a36',
  'border-radius:8px',
  'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
  'z-index:50',
].join(';');

const BUTTON_STYLE = [
  'cursor:pointer',
  'background:#3a2f22',
  'color:#e8dcc8',
  'border:1px solid #6b5840',
  'border-radius:5px',
  'padding:4px 7px',
  'font:12px ui-monospace,monospace',
].join(';');

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  style: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The two gallery layouts: play every sequence (`anim`), or play the walk once per head look (`heads`). */
export type GalleryView = 'anim' | 'heads';

/** Parse `?view=` — `heads`/`looks`/`glowy` → the looks montage, anything else (incl. absent) → the animation view. */
export function parseView(raw: string | null): GalleryView {
  return raw === 'heads' || raw === 'looks' || raw === 'glowy' ? 'heads' : 'anim';
}

/**
 * The eight facing options + "full", in a human-friendly compass order (NOT raw block index order). The
 * `dir` is the `CR_Hum_Body` block index the gallery indexes (`0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S,
 * 7 N` — docs/FIDELITY.md "Settler facing"); the label is the screen facing that block draws.
 */
const DIRECTION_OPTIONS: readonly { readonly label: string; readonly dir: GalleryDirection }[] = [
  { label: 'Pełna', dir: 'full' },
  { label: 'N', dir: 7 },
  { label: 'NE', dir: 3 },
  { label: 'E', dir: 4 },
  { label: 'SE', dir: 5 },
  { label: 'S', dir: 6 },
  { label: 'SW', dir: 0 },
  { label: 'W', dir: 1 },
  { label: 'NW', dir: 2 },
];

/** Human label for a `GalleryDirection` (the readout line). */
function directionLabel(dir: GalleryDirection): string {
  return DIRECTION_OPTIONS.find((o) => o.dir === dir)?.label ?? String(dir);
}

/** Parse `?dir=` — `full`/absent → `'full'`, an integer `0..GALLERY_DIRS-1` → that block, else → `'full'`. */
export function parseDirection(raw: string | null): GalleryDirection {
  if (raw === null || raw === 'full' || raw === 'all') return 'full';
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n >= 0 && n < GALLERY_DIRS ? n : 'full';
}

/** Parse a positive-int URL param (e.g. `?cols=6`), falling back when absent or invalid. */
function intParam(params: URLSearchParams, name: string, fallback: number): number {
  const raw = params.get(name);
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/**
 * A readable label for a raw `[bobseq]` name: drop the `human_<species>_` prefix and turn the
 * `snake_case`/`CamelCase` remainder into spaced words (`human_man_Warrior_Broadsword_attack` → "Warrior
 * Broadsword attack"). Purely cosmetic — the raw name still uniquely identifies the sequence.
 */
export function prettyClipLabel(name: string): string {
  return name
    .replace(/^human_(man|woman|child_boy|child_girl|child_baby)_/i, '')
    .replace(/_/g, ' ')
    .trim();
}

/** Turn one decoded `[bobseq]` row into a {@link GalleryClip} (its direction count from {@link clipDirs}). */
function clipFromRow(row: BobSeqRow): GalleryClip {
  return {
    label: prettyClipLabel(row.name),
    start: row.start,
    length: row.length,
    dirs: clipDirs(row.length),
  };
}

/**
 * Turn the decoded `[bobseq]` rows into {@link GalleryClip}s — the load-bearing, browser-free data step.
 * Each clip gets its {@link clipDirs} direction count; a `filter` substring narrows by name. The HEAD
 * FALLBACK: a walk-layout carry variant (`length === walk.length`, not walk itself) whose OWN head bob is
 * empty (`headAtlas` has no non-zero frame at its start) borrows the base `human_man_generic_walk` head, so
 * it isn't drawn headless (the head faces the walk heading while the body carries the load). `walkRow` is
 * resolved from the UNFILTERED rows, so `?filter=bread` still finds the walk head to borrow. Pure (given
 * the head atlas as data) + exported so this join is unit-tested without a browser.
 */
export function buildGalleryClips(
  rows: readonly BobSeqRow[],
  headAtlas: SpriteAtlas | undefined,
  filter = '',
): GalleryClip[] {
  const walkRow = rows.find((r) => r.name === WALK_SEQ);
  const headEmptyAt = (start: number): boolean => {
    const f = headAtlas?.frames.get(start);
    return f === undefined || f.width === 0 || f.height === 0;
  };
  const needle = filter.toLowerCase();
  return rows
    .filter((r) => needle === '' || r.name.toLowerCase().includes(needle))
    .map((r) => {
      const base: GalleryClip = clipFromRow(r);
      if (
        walkRow !== undefined &&
        r.name !== WALK_SEQ &&
        r.length === walkRow.length &&
        headEmptyAt(r.start)
      ) {
        return { ...base, headStart: walkRow.start };
      }
      return base;
    });
}

/**
 * The cells for the ANIMATION view: every sequence of the body, each drawn with the character's default
 * head (`heads[0]`). Pure over the loaded layers — the browser-free join of {@link buildGalleryClips} with
 * the shared (body, head) so it's exercised without a GPU.
 */
export function buildAnimCells(
  rows: readonly BobSeqRow[],
  body: SpriteLayer,
  defaultHead: SpriteLayer | undefined,
  filter = '',
): GalleryCellSpec[] {
  const clips = buildGalleryClips(rows, defaultHead?.atlas, filter);
  const overlays = defaultHead !== undefined ? [defaultHead] : [];
  return clips.map((clip) => ({ clip, body, overlays }));
}

/**
 * The cells for the HEADS view: the plain walk ({@link pickWalkRow}) played once per head LOOK, each cell
 * captioned by its head. `heads[i]` lines up with `headBmds[i]` (both in roster/stem order). A `filter`
 * narrows by head label or bmd name. Returns `[]` when the body has no playable clip. Pure over the loaded
 * layers so the montage assembly is unit-tested without a browser.
 */
export function buildHeadsCells(
  char: VikingCharacter,
  rows: readonly BobSeqRow[],
  body: SpriteLayer,
  heads: readonly (SpriteLayer | undefined)[],
  filter = '',
): GalleryCellSpec[] {
  const walkRow = pickWalkRow(rows);
  if (walkRow === undefined) return [];
  const walkClip = clipFromRow(walkRow);
  const needle = filter.toLowerCase();
  if (char.headBmds.length === 0) {
    // Body-only creature (the baby): a single bare cell so the view isn't empty.
    return needle === '' || char.label.toLowerCase().includes(needle)
      ? [{ clip: walkClip, body, overlays: [], label: char.label }]
      : [];
  }
  const cells: GalleryCellSpec[] = [];
  for (let i = 0; i < char.headBmds.length; i++) {
    const bmd = char.headBmds[i];
    const layer = heads[i];
    if (bmd === undefined || layer === undefined) continue;
    const label = headLabel(bmd);
    if (needle !== '' && !label.toLowerCase().includes(needle) && !bmd.toLowerCase().includes(needle)) {
      continue;
    }
    cells.push({ clip: walkClip, body, overlays: [layer], label });
  }
  return cells;
}

/** Mount a small message panel (missing `content/`, or an empty filter) instead of a blank canvas. */
function mountMessage(title: string, detail: string): void {
  const panel = el('div', PANEL_STYLE);
  panel.append(
    el('div', 'font-weight:700;font-size:14px;margin-bottom:6px', title),
    el('div', 'opacity:0.85', detail),
  );
  document.body.append(panel);
}

export async function renderAnimationGallery(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
): Promise<void> {
  // No `?char=` → the DEFAULT landing: the WHOLE roster on one screen, every look walking, nothing to
  // click. A `?char=` drills into that one body — its full animation set (`?view=anim`) or its heads montage.
  if (params.get('char') === null) {
    await renderRosterMontage(canvas, params);
  } else {
    await renderCharacterGallery(canvas, params);
  }
}

/** One character's loaded layers + `[bobseq]` rows — the input {@link buildRosterCells} joins into cells. */
export interface RosterLoad {
  readonly char: VikingCharacter;
  readonly body: SpriteLayer;
  readonly heads: readonly (SpriteLayer | undefined)[];
  readonly rows: readonly BobSeqRow[];
}

/**
 * The full-roster montage — the "pełny set wikingów" on ONE image: one animated cell per viking LOOK (every
 * roster body × each of its heads), all playing the plain walk. Each body is loaded in turn; a body absent
 * from a partial `content/` is skipped (not fatal) so the rest still show. Degrades to a message only when
 * NOTHING loads.
 */
async function renderRosterMontage(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const rawFilter = params.get('filter') ?? '';
  const loaded: RosterLoad[] = [];
  let loadedAny = false;
  for (const char of VIKING_CHARACTERS) {
    const { bodyStem, headStems } = characterStems(char);
    try {
      const { body, heads } = await loadGalleryLayers(bodyStem, headStems);
      loadedAny = true;
      loaded.push({ char, body, heads, rows: await loadBodyClips(char.imagelib) });
    } catch (err) {
      if (err instanceof MissingAtlasError) continue; // a body missing from a partial content/ — skip it
      throw err;
    }
  }
  if (!loadedAny) {
    mountMessage(
      'Brak grafik (content/)',
      'Uruchom `npm run pipeline` na posiadanej kopii gry, aby wypełnić content/ — galeria potrzebuje zdekodowanego atlasu bobów.',
    );
    return;
  }
  const cells = buildRosterCells(loaded, rawFilter);
  if (cells.length === 0) {
    mountMessage(
      'Brak looków',
      rawFilter === ''
        ? 'content/ir.json nie zawiera odtwarzalnych sekwencji dla rosteru — uruchom `npm run pipeline`.'
        : `Żaden wygląd nie pasuje do filtra „${rawFilter}".`,
    );
    return;
  }
  await startGallery(canvas, params, cells, { char: null, view: 'anim' });
  console.log(
    `Vinland viking roster montage: ${cells.length} looks, each walking. Click a character to see its animations.`,
  );
}

/**
 * The roster montage's cells: for each loaded character, its plain walk ({@link pickWalkRow}) played once
 * per head look, captioned {@link rosterLabel}. `heads[i]` lines up with `char.headBmds[i]`. A `filter`
 * narrows by caption. Pure over the loaded layers so the montage assembly is unit-tested without a browser.
 */
export function buildRosterCells(loaded: readonly RosterLoad[], filter = ''): GalleryCellSpec[] {
  const needle = filter.toLowerCase();
  const cells: GalleryCellSpec[] = [];
  for (const { char, body, heads, rows } of loaded) {
    const walkRow = pickWalkRow(rows);
    if (walkRow === undefined) continue;
    const walkClip = clipFromRow(walkRow);
    if (char.headBmds.length === 0) {
      // Body-only creature (the baby): one bare cell, no head overlay.
      if (needle === '' || char.label.toLowerCase().includes(needle)) {
        cells.push({ clip: walkClip, body, overlays: [], label: char.label });
      }
      continue;
    }
    for (let i = 0; i < char.headBmds.length; i++) {
      const layer = heads[i];
      const bmd = char.headBmds[i];
      if (layer === undefined || bmd === undefined) continue; // a listed head that failed to load — skip
      const label = rosterLabel(char, bmd);
      if (needle !== '' && !label.toLowerCase().includes(needle)) continue;
      cells.push({ clip: walkClip, body, overlays: [layer], label });
    }
  }
  return cells;
}

/** A compact roster caption: the character label, plus the head index when the body has several looks. */
export function rosterLabel(char: VikingCharacter, headBmd: string): string {
  if (char.headBmds.length < 2) return char.label;
  const m = /_(\d+)$/.exec(headBmd);
  return m !== null ? `${char.label} ${m[1]}` : char.label;
}

/**
 * One character's gallery drill-down: its full animation set (`?view=anim`) or its heads/looks montage
 * (`?view=heads`) — reached by clicking a character in the roster panel.
 */
async function renderCharacterGallery(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const char = findCharacter(params.get('char'));
  const view = parseView(params.get('view'));
  const { bodyStem, headStems } = characterStems(char, DEFAULT_CHARACTER_PALETTE);

  let body: SpriteLayer;
  let heads: (SpriteLayer | undefined)[];
  try {
    ({ body, heads } = await loadGalleryLayers(bodyStem, headStems));
  } catch (err) {
    if (!(err instanceof MissingAtlasError)) throw err;
    mountMessage(
      'Brak grafik (content/)',
      `Uruchom \`npm run pipeline\` na posiadanej kopii gry, aby wypełnić content/ — galeria potrzebuje zdekodowanego atlasu „${char.label}" (${bodyStem}).`,
    );
    return;
  }

  const filter = params.get('filter') ?? '';
  const rows = await loadBodyClips(char.imagelib);
  const cells =
    view === 'heads'
      ? buildHeadsCells(char, rows, body, heads, filter)
      : buildAnimCells(rows, body, heads[0], filter);

  if (cells.length === 0) {
    const what = view === 'heads' ? 'głów' : 'sekwencji';
    mountMessage(
      `Brak ${what}`,
      filter === ''
        ? `content/ir.json nie zawiera odtwarzalnych klatek dla „${char.label}" (${char.imagelib}).`
        : `Nic nie pasuje do filtra „${filter}".`,
    );
    return;
  }

  await startGallery(canvas, params, cells, { char, view });
  console.log(
    `Vinland animation gallery: ${char.label} (${char.imagelib}), view=${view}, ${cells.length} cells.`,
  );
}

/** Create the Pixi app + retained gallery, frame it with an initial camera, mount the panel, and run the loop. */
async function startGallery(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
  cells: readonly GalleryCellSpec[],
  overlay: { readonly char: VikingCharacter | null; readonly view: GalleryView },
): Promise<void> {
  // Window-sized 1:1 backing store: resizing the browser changes the visible field, never the scale.
  const app = await createWindowPixiApp(canvas);
  const columns = intParam(params, 'cols', DEFAULT_COLUMNS);
  const direction = parseDirection(params.get('dir'));
  const gallery = new AnimationGallery(app, { cells, columns, direction });

  // Initial camera: fit the grid WIDTH into the canvas (capped at 1×), top-left at a margin; the human
  // pans (middle-mouse / arrows) and zooms (wheel) from there. `?zoom=` overrides the fit.
  const content = gallery.contentSize();
  const fitZoom = Math.max(MIN_ZOOM, Math.min(1, (app.screen.width - 2 * GRID_MARGIN) / content.width));
  const zoom = floatParam(params, 'zoom', fitZoom);
  const cameraCtl = createCameraController(canvas, {
    offsetX: GRID_MARGIN,
    offsetY: GRID_MARGIN,
    scale: zoom,
  });

  // The overlay's direction buttons drive `gallery.setDirection` (live); the character / view buttons
  // navigate (they reload different atlases), so the panel isn't touched in the loop below.
  mountGalleryOverlay(params, { ...overlay, cellCount: cells.length, direction }, (d) =>
    gallery.setDirection(d),
  );

  const speed = floatParam(params, 'speed', 1);
  let clock = 0;
  let lastMs = performance.now();
  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;
    clock += speed; // a view-frame counter; the gallery's `ticksPerFrame` sets the on-screen cadence
    cameraCtl.update(elapsed);
    gallery.update(clock, cameraCtl.camera());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/** The URL for the same gallery with some params overridden (character / view navigation). */
function galleryUrl(base: URLSearchParams, changes: Readonly<Record<string, string>>): string {
  const next = new URLSearchParams(base);
  next.set('anim', ''); // keep the `?anim` entry itself
  for (const [k, v] of Object.entries(changes)) next.set(k, v);
  return `?${next.toString()}`;
}

/** The URL of the no-param roster montage — drop the character/view drill-down keys ("Wszystkie"). */
function rosterUrl(base: URLSearchParams): string {
  const next = new URLSearchParams(base);
  next.set('anim', '');
  next.delete('char');
  next.delete('view');
  return `?${next.toString()}`;
}

/** A button that navigates the page (reloads with new params) — used for the character + view selectors. */
function navButton(label: string, active: boolean, href: string): HTMLButtonElement {
  const b = el('button', BUTTON_STYLE, label);
  if (active) {
    b.style.background = '#6b5840';
    b.style.fontWeight = '700';
  }
  b.addEventListener('click', () => {
    window.location.search = href;
  });
  return b;
}

/** Mount the gallery's control panel: title, character + view + direction selectors, and a validation checklist. */
function mountGalleryOverlay(
  params: URLSearchParams,
  state: {
    readonly char: VikingCharacter | null;
    readonly view: GalleryView;
    readonly cellCount: number;
    readonly direction: GalleryDirection;
  },
  onDirection: (d: GalleryDirection) => void,
): void {
  const { char, view, cellCount, direction } = state;
  const panel = el('div', PANEL_STYLE);
  panel.append(el('div', 'font-weight:700;font-size:14px;margin-bottom:2px', 'Animacje postaci wikinga'));

  // Character selector — navigates (each character is a different body/head atlas set). "Wszystkie" is the
  // no-param roster montage (the default); a character drills into its own animations.
  panel.append(el('div', 'font-weight:700;margin:6px 0 4px', 'Postać:'));
  const charRow = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px');
  charRow.append(navButton('Wszystkie', char === null, rosterUrl(params)));
  for (const c of VIKING_CHARACTERS) {
    charRow.append(
      navButton(c.label, char !== null && c.id === char.id, galleryUrl(params, { char: c.id, view: 'anim' })),
    );
  }
  panel.append(charRow);

  // View selector — a single character with 2+ looks: its animation set vs its heads montage. The roster IS
  // the all-looks view, and a single-/no-head character (woman / child / baby) has nothing to montage.
  if (char !== null && char.headBmds.length >= 2) {
    panel.append(el('div', 'font-weight:700;margin:2px 0 4px', 'Widok:'));
    const viewRow = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px');
    viewRow.append(
      navButton('Animacje', view === 'anim', galleryUrl(params, { char: char.id, view: 'anim' })),
      navButton(
        `Głowy (${char.headBmds.length})`,
        view === 'heads',
        galleryUrl(params, { char: char.id, view: 'heads' }),
      ),
    );
    panel.append(viewRow);
  }

  const summary =
    char === null
      ? `${cellCount} wyglądów wikingów naraz — każdy idzie ten sam walk. Kliknij postać, by zobaczyć jej animacje.`
      : view === 'heads'
        ? `${cellCount} looków (głów) „${char.label}", każdy idzie ten sam walk.`
        : `${cellCount} sekwencji „${char.label}" naraz, każda w pętli.`;
  panel.append(el('div', 'opacity:0.85;margin-bottom:8px', summary));

  // Direction selector — LIVE (no reload); applies to every cell.
  panel.append(el('div', 'font-weight:700;margin-bottom:4px', 'Kierunek:'));
  const dirRow = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px');
  const buttons = new Map<GalleryDirection, HTMLButtonElement>();
  const mark = (active: GalleryDirection): void => {
    for (const [dir, b] of buttons) {
      const on = dir === active;
      b.style.background = on ? '#6b5840' : '#3a2f22';
      b.style.fontWeight = on ? '700' : '400';
    }
  };
  for (const opt of DIRECTION_OPTIONS) {
    const b = el('button', BUTTON_STYLE, opt.label);
    b.addEventListener('click', () => {
      onDirection(opt.dir);
      mark(opt.dir);
      readout.textContent = `Aktualny: ${directionLabel(opt.dir)}`;
    });
    buttons.set(opt.dir, b);
    dirRow.append(b);
  }
  panel.append(dirRow);

  const readout = el('div', 'opacity:0.8;margin-bottom:6px', `Aktualny: ${directionLabel(direction)}`);
  panel.append(readout);
  mark(direction);

  panel.append(el('div', 'font-weight:700;margin:4px 0', 'Sprawdź:'));
  const list = el('ul', 'margin:0 0 8px 0;padding-left:18px');
  const items =
    char === null
      ? [
          'To pełny set wikingów naraz: cywil (12 głów), wojownik (4), kobieta, dzieci, niemowlę',
          'Każdy ma ciało + głowę (żaden bezgłowy ani zniekształcony), głowy się różnią',
          'Po wyborze kierunku wszyscy idą w tę samą, właściwą stronę',
          'Kliknij postać (np. Wojownik), by zobaczyć jej pełne animacje, w tym walki',
          'ZNANY BRAK: kolor skóry/włosów to dziś jedna paleta (warianty = osobny krok w pipeline)',
        ]
      : view === 'heads'
        ? [
            'Każdy look ma ciało + głowę (żaden nie jest bezgłowy ani zniekształcony)',
            'Głowy różnią się (włosy/hełmy/twarze) — to pełny zestaw wyglądów tej postaci',
            'Po wyborze kierunku wszystkie looki patrzą w tę samą, właściwą stronę',
            'ZNANY BRAK: kolor skóry/włosów to dziś jedna paleta (warianty = osobny krok w pipeline)',
          ]
        : [
            'Każda animacja gra płynnie i się zapętla — żadna klatka nie jest zamrożona ani zniekształcona',
            'Postać ma ciało + głowę (nie sam korpus)',
            'RUCH (walk + warianty niesienia/broni) po wyborze kierunku patrzy we właściwą stronę',
            'WOJOWNIK: ataki (miecz/łuk/oszczep/pięści) są czytelne (grają całą sekwencję, 1-kierunkowo)',
            'Animacje 1-kierunkowe (wait, eat, sleep, ataki) ignorują wybór kierunku — grają całą sekwencję',
            'ZNANY BRAK: gesty/praca/ataki mogą mieć błędne kierunki — kolejność per-animacja nieskalibrowana',
          ];
  for (const item of items) list.append(el('li', 'margin:2px 0', item));
  panel.append(list);
  panel.append(
    el(
      'div',
      'opacity:0.65;font-size:12px;border-top:1px solid #5a4a36;padding-top:6px',
      'Gdy ocenisz animacje, wróć do czatu i napisz, czy są OK.',
    ),
  );

  document.body.append(panel);
}
