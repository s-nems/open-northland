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
import { loadBodyClips, loadGalleryLayers, loadPlayerLut, MissingAtlasError } from '../content/ir/load.js';
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
 * The `?anim` entry: the character animation gallery, where a human validates that each extracted
 * `[bobseq]` decodes, cycles, and reads correctly in all 8 directions. A pure viewer with no sim.
 * Real decoded graphics are required; a checkout without `content/` shows a "run the pipeline" message.
 */

const DEFAULT_COLUMNS = 8;
/** Screen margin (px) the grid's top-left starts at under the initial camera. */
const GRID_MARGIN = 40;

export async function renderAnimationGallery(
  canvas: HTMLCanvasElement,
  params: URLSearchParams,
): Promise<void> {
  if (params.get('char') === null) {
    await renderRosterMontage(canvas, params);
  } else {
    await renderCharacterGallery(canvas, params);
  }
}

/**
 * One animated cell per viking look, all playing the plain walk. A body absent from a partial
 * `content/` is skipped so the rest still show; only an empty load degrades to a message.
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
      if (err instanceof MissingAtlasError) continue;
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

async function renderCharacterGallery(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  const char = findCharacter(params.get('char'));
  const character = characterLabel(char);
  const copy = messages().animation;
  const view = parseView(params.get('view'));
  const color = parseColor(params.get('color'), PLAYER_COLOR_COUNT);
  // Paletted mode loads the indexed atlases and the player-colour LUT, so the character is recoloured
  // per player at draw time.
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

  // The LUT row count comes from the texture's own height, not a constant, so the shader's row lookup
  // cannot desync from the PNG.
  const palette = lut !== undefined ? { source: lut, colours: lut.pixelHeight } : undefined;
  await startGallery(canvas, params, cells, { char, view }, palette);
}

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

  const content = gallery.contentSize();
  const fitZoom = Math.max(MIN_ZOOM, Math.min(1, (app.screen.width - 2 * GRID_MARGIN) / content.width));
  const zoom = floatParam(params, 'zoom', fitZoom);
  const cameraCtl = createCameraController(
    canvas,
    { offsetX: GRID_MARGIN, offsetY: GRID_MARGIN, scale: zoom },
    app.renderer.resolution,
  );

  // The direction buttons drive `setDirection` live; the character and view buttons navigate, so the
  // panel is never touched in the loop below.
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
