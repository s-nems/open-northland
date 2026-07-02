import {
  AnimationGallery,
  type Camera,
  GALLERY_DIRS,
  type GalleryClip,
  type GalleryDirection,
  type SpriteAtlas,
  clipDirs,
  createPixiApp,
} from '@vinland/render';
import { MIN_ZOOM, createCameraController, floatParam } from './camera.js';
import {
  BODY_IMAGELIB,
  type BobSeqRow,
  MissingAtlasError,
  loadBodyClips,
  loadHumanBodyHead,
} from './real-sprites.js';

/**
 * The `?anim` entry — the character **animation gallery**, the animation twin of the `?scene=all-buildings`
 * catalog. It plays every extracted `[bobseq]` of the viking civilian body straight from the atlas so a
 * human can validate that each animation decodes, cycles, and (for the locomotion clips) reads correctly
 * in all 8 directions. A pure viewer: no sim, DOM + wall-clock are fine here (`app` boundary).
 *
 * Flags: `?anim[&dir=full|0..7&cols=N&zoom=&speed=&filter=<substr>]`. `dir` picks the global facing every
 * clip plays (default `full` = each whole sequence); `filter` narrows to sequences whose name contains the
 * substring. Real decoded graphics are required — a checkout without `content/` shows a "run the pipeline"
 * message instead of crashing.
 */

const CANVAS_W = 1120;
const CANVAS_H = 720;
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
 * A readable label for a raw `[bobseq]` name: drop the `human_man_` species/gender prefix and turn the
 * `snake_case`/`CamelCase` remainder into spaced words (`human_man_Civilian_Fight_punch` → "Civilian
 * Fight punch"). Purely cosmetic — the raw name still uniquely identifies the sequence.
 */
export function prettyClipLabel(name: string): string {
  return name
    .replace(/^human_(man|woman)_/i, '')
    .replace(/_/g, ' ')
    .trim();
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
      const base: GalleryClip = {
        label: prettyClipLabel(r.name),
        start: r.start,
        length: r.length,
        dirs: clipDirs(r.length),
      };
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
  // The gallery needs only the body + head layers — degrade to a message (not markers) when they're absent.
  // The lean loader avoids pulling in the tree/house/family atlases, so a partial content/ still opens here.
  let body: Awaited<ReturnType<typeof loadHumanBodyHead>>['body'];
  let head: Awaited<ReturnType<typeof loadHumanBodyHead>>['head'];
  try {
    ({ body, head } = await loadHumanBodyHead());
  } catch (err) {
    if (!(err instanceof MissingAtlasError)) throw err;
    mountMessage(
      'Brak grafik (content/)',
      'Uruchom `npm run pipeline` na posiadanej kopii gry, aby wypełnić content/ — galeria animacji potrzebuje zdekodowanego atlasu bobów.',
    );
    return;
  }

  const filter = params.get('filter') ?? '';
  const rows = await loadBodyClips(BODY_IMAGELIB);
  const clips = buildGalleryClips(rows, head.atlas, filter);

  if (clips.length === 0) {
    mountMessage(
      'Brak sekwencji',
      filter === ''
        ? `content/ir.json nie zawiera bobSequences dla ${BODY_IMAGELIB}.`
        : `Żadna animacja nie pasuje do filtra „${filter}".`,
    );
    return;
  }

  const app = await createPixiApp(canvas, CANVAS_W, CANVAS_H);
  const columns = intParam(params, 'cols', DEFAULT_COLUMNS);
  const direction = parseDirection(params.get('dir'));
  const gallery = new AnimationGallery(app, { body, overlays: [head], clips, columns, direction });

  // Initial camera: fit the grid WIDTH into the canvas (capped at 1×), top-left at a margin; the human
  // pans (middle-mouse / arrows) and zooms (wheel) from there. `?zoom=` overrides the fit.
  const content = gallery.contentSize();
  const fitZoom = Math.max(MIN_ZOOM, Math.min(1, (CANVAS_W - 2 * GRID_MARGIN) / content.width));
  const zoom = floatParam(params, 'zoom', fitZoom);
  const initial: Camera = { offsetX: GRID_MARGIN, offsetY: GRID_MARGIN, scale: zoom };
  const cameraCtl = createCameraController(canvas, initial);

  // The overlay's direction buttons drive `gallery.setDirection` and self-mark on click, so nothing about
  // the panel needs a per-frame refresh — it isn't touched in the loop below.
  mountGalleryOverlay(clips.length, direction, (d) => gallery.setDirection(d));

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

  console.log(
    `Vinland animation gallery up: ${clips.length} sequences of ${BODY_IMAGELIB}. Toggle direction in the panel; drag (middle mouse)/arrows pan, wheel zooms.`,
  );
}

/** Mount the gallery's control panel: title, direction buttons, current facing, and a validation checklist. */
function mountGalleryOverlay(
  clipCount: number,
  initial: GalleryDirection,
  onDirection: (d: GalleryDirection) => void,
): void {
  const panel = el('div', PANEL_STYLE);
  panel.append(
    el('div', 'font-weight:700;font-size:14px;margin-bottom:2px', 'Animacje postaci wikinga'),
    el(
      'div',
      'opacity:0.85;margin-bottom:8px',
      `${clipCount} sekwencji naraz. Każda gra w pętli (nigdy zamrożona). Wybierz kierunek, by sprawdzić 8 stron świata; „Pełna" gra całą sekwencję.`,
    ),
    el('div', 'font-weight:700;margin-bottom:4px', 'Kierunek:'),
  );

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

  const readout = el('div', 'opacity:0.8;margin-bottom:6px', `Aktualny: ${directionLabel(initial)}`);
  panel.append(readout);
  mark(initial);

  panel.append(el('div', 'font-weight:700;margin:4px 0', 'Sprawdź:'));
  const list = el('ul', 'margin:0 0 8px 0;padding-left:18px');
  for (const item of [
    'Każda animacja gra płynnie i się zapętla — żadna klatka nie jest zamrożona ani zniekształcona',
    'Postać ma ciało + głowę (nie sam korpus)',
    'RUCH (walk + warianty niesienia) po wyborze kierunku (N…NW) patrzy we właściwą stronę',
    'Animacje 1-kierunkowe (wait, eat, sleep, walki) ignorują wybór kierunku — grają całą sekwencję',
    'ZNANY BRAK: gesty/praca (np. speak, pray) mogą mieć błędne kierunki — kolejność per-animacja nieskalibrowana',
    '„Pełna" gra całą sekwencję, a animacje 8-kierunkowe obraca w kółko (N→NE→E→…)',
  ]) {
    list.append(el('li', 'margin:2px 0', item));
  }
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
