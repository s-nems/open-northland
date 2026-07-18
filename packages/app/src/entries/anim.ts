import {
  AnimationGallery,
  createWindowPixiApp,
  type GalleryCellSpec,
  type SpriteLayer,
  type TextureSource,
} from '@open-northland/render';
import {
  characterLabel,
  characterStems,
  DEFAULT_CHARACTER_PALETTE,
  findCharacter,
  INDEXED_CHARACTER_PALETTE,
  PLAYER_COLOR_COUNT,
  VIKING_CHARACTERS,
  type VikingCharacter,
} from '../catalog/roster.js';
import { loadBodyClips, loadGalleryLayers, loadPlayerLut, MissingAtlasError } from '../content/ir.js';
import { formatMessage, messages } from '../i18n/index.js';
import { createCameraController, MIN_ZOOM } from '../view/camera/index.js';
import { mountMessage } from '../view/overlay.js';
import { floatParam, intParam } from '../view/params.js';
import {
  buildAnimCells,
  buildColorCells,
  buildHeadsCells,
  buildRosterCells,
  type GalleryView,
  parseColor,
  parseDirection,
  parseView,
  type RosterLoad,
} from './anim-cells.js';
import { mountGalleryOverlay } from './anim-overlay.js';

/**
 * The `?anim` entry — the character animation gallery, the animation twin of the sandbox/catalog
 * catalog. It plays the extracted `[bobseq]` of a viking body straight from the atlas so a human can
 * validate that each animation decodes, cycles, and (for the locomotion clips) reads correctly in all 8
 * directions. A pure viewer: no sim, DOM + wall-clock are fine here (`app` boundary). This file holds the
 * atlas loading + Pixi loop; the browser-free cell/URL builders live in `anim-cells.ts` and the DOM panel
 * in `anim-overlay.ts`.
 *
 * Two axes over the full viking roster ({@link VIKING_CHARACTERS}):
 *  - `?char=<id>` picks the character — civilian / warrior (its own broadsword / sword / bow / spear /
 *    bare-handed combat set) / woman / child / baby. Changing it reloads that body + head atlases.
 *  - `?view=anim|heads` picks the layout — `anim` (default) plays every sequence of the body with its
 *    default head; `heads` plays the plain walk once per head look, the montage of all faces/hats.
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
  // No `?char=` → the default landing: the whole roster on one screen, every look walking, nothing to
  // click. A `?char=` drills into that one body — its full animation set (`?view=anim`) or its heads montage.
  if (params.get('char') === null) {
    await renderRosterMontage(canvas, params);
  } else {
    await renderCharacterGallery(canvas, params);
  }
}

/**
 * The full-roster montage — the "pełny set wikingów" on one image: one animated cell per viking look (every
 * roster body × each of its heads), all playing the plain walk. Each body is loaded in turn; a body absent
 * from a partial `content/` is skipped (not fatal) so the rest still show. Degrades to a message only when
 * nothing loads.
 */
async function renderRosterMontage(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const copy = messages().animation;
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
    mountMessage(messages().common.missingContentTitle, copy.missingRoster);
    return;
  }
  const cells = buildRosterCells(loaded, rawFilter);
  if (cells.length === 0) {
    mountMessage(
      copy.noLooks,
      rawFilter === '' ? copy.noRosterFrames : formatMessage(copy.filterNoMatch, { filter: rawFilter }),
    );
    return;
  }
  await startGallery(canvas, params, cells, { char: null, view: 'anim' });
}

/**
 * One character's gallery drill-down: its full animation set (`?view=anim`) or its heads/looks montage
 * (`?view=heads`) — reached by clicking a character in the roster panel.
 */
async function renderCharacterGallery(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const char = findCharacter(params.get('char'));
  const character = characterLabel(char);
  const copy = messages().animation;
  const view = parseView(params.get('view'));
  const color = parseColor(params.get('color'), PLAYER_COLOR_COUNT);
  // Paletted mode = the colours montage, or an explicit `?color=` on the anim/heads views. It loads the
  // indexed atlases + the player-colour LUT so the character is recoloured per player at draw time.
  const paletted = view === 'colors' || color !== null;
  const { bodyStem, headStems } = characterStems(
    char,
    paletted ? INDEXED_CHARACTER_PALETTE : DEFAULT_CHARACTER_PALETTE,
  );

  let body: SpriteLayer;
  let heads: (SpriteLayer | undefined)[];
  try {
    ({ body, heads } = await loadGalleryLayers(bodyStem, headStems));
  } catch (err) {
    if (!(err instanceof MissingAtlasError)) throw err;
    mountMessage(
      messages().common.missingContentTitle,
      formatMessage(copy.missingAtlas, { character, stem: bodyStem }),
    );
    return;
  }

  let lut: TextureSource | undefined;
  if (paletted) {
    lut = await loadPlayerLut();
    if (lut === undefined) {
      mountMessage(copy.missingPalette, copy.missingPaletteDetail);
      return;
    }
  }

  const filter = params.get('filter') ?? '';
  const rows = await loadBodyClips(char.imagelib);
  const player = color ?? 0;
  const cells =
    view === 'colors'
      ? buildColorCells(rows, body, heads[0], messages().animation.playerColors, filter)
      : view === 'heads'
        ? buildHeadsCells(char, rows, body, heads, filter).map((c) => ({ ...c, player }))
        : buildAnimCells(rows, body, heads[0], filter).map((c) => ({ ...c, player }));

  if (cells.length === 0) {
    const title = view === 'heads' ? copy.noHeads : view === 'colors' ? copy.noColors : copy.noSequences;
    mountMessage(
      title,
      filter === ''
        ? formatMessage(copy.missingFrames, { character, imagelib: char.imagelib })
        : formatMessage(copy.filterNoMatch, { filter }),
    );
    return;
  }

  // The LUT row count for the shader comes from the texture's own height, not a constant, so the fragment's
  // row lookup can't desync from the actual PNG if the two ever diverge (parseColor still bounds `?color=` by
  // PLAYER_COLOR_COUNT, a UI range).
  const palette = lut !== undefined ? { source: lut, colours: lut.pixelHeight } : undefined;
  await startGallery(canvas, params, cells, { char, view }, palette);
}

/** Create the Pixi app + retained gallery, frame it with an initial camera, mount the panel, and run the loop. */
async function startGallery(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
  cells: readonly GalleryCellSpec[],
  overlay: { readonly char: VikingCharacter | null; readonly view: GalleryView },
  palette?: { readonly source: TextureSource; readonly colours: number },
): Promise<void> {
  // Window-tracking, device-resolution backing store: resizing changes the visible field, never the scale.
  const app = await createWindowPixiApp(canvas);
  const columns = intParam(params, 'cols', DEFAULT_COLUMNS, 1);
  const direction = parseDirection(params.get('dir'));
  const gallery = new AnimationGallery(app, {
    cells,
    columns,
    direction,
    ...(palette !== undefined ? { palette } : {}),
  });

  // Initial camera: fit the grid width into the canvas (capped at 1×), top-left at a margin; the human
  // pans (middle-mouse / arrows) and zooms (wheel) from there. `?zoom=` overrides the fit.
  const content = gallery.contentSize();
  const fitZoom = Math.max(MIN_ZOOM, Math.min(1, (app.screen.width - 2 * GRID_MARGIN) / content.width));
  const zoom = floatParam(params, 'zoom', fitZoom);
  const cameraCtl = createCameraController(
    canvas,
    { offsetX: GRID_MARGIN, offsetY: GRID_MARGIN, scale: zoom },
    app.renderer.resolution,
  );

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
