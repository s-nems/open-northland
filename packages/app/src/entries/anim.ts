import {
  AnimationGallery,
  type GalleryCellSpec,
  type SpriteLayer,
  createWindowPixiApp,
} from '@vinland/render';
import {
  DEFAULT_CHARACTER_PALETTE,
  VIKING_CHARACTERS,
  type VikingCharacter,
  characterStems,
  findCharacter,
} from '../catalog/roster.js';
import { MissingAtlasError, loadBodyClips, loadGalleryLayers } from '../content/ir.js';
import { MIN_ZOOM, createCameraController } from '../view/camera.js';
import { mountMessage } from '../view/overlay.js';
import {
  type GalleryView,
  type RosterLoad,
  buildAnimCells,
  buildHeadsCells,
  buildRosterCells,
  parseDirection,
  parseView,
} from './anim-cells.js';
import { mountGalleryOverlay } from './anim-overlay.js';
import { floatParam, intParam } from './params.js';

/**
 * The `?anim` entry — the character **animation gallery**, the animation twin of the `?scene=all-buildings`
 * catalog. It plays the extracted `[bobseq]` of a viking body straight from the atlas so a human can
 * validate that each animation decodes, cycles, and (for the locomotion clips) reads correctly in all 8
 * directions. A pure viewer: no sim, DOM + wall-clock are fine here (`app` boundary). This file holds the
 * atlas loading + Pixi loop; the browser-free cell/URL builders live in `anim-cells.ts` and the DOM panel
 * in `anim-overlay.ts`.
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
  const columns = intParam(params, 'cols', DEFAULT_COLUMNS, 1);
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
