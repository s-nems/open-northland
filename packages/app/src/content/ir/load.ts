import {
  type AtlasManifest,
  atlasFromManifest,
  type BuildTimeSheet,
  loadAtlasSource,
  type SpriteLayer,
  type TextureSource,
} from '@open-northland/render';
import { fetchImageData, fetchJsonOrNull, loadTextureIfPresent } from '../net.js';
import { BODY_IMAGELIB, type BobSeqRow, type ContentIr } from './rows.js';

/**
 * The decoded atlas isn't served (the pipeline hasn't run, or `content/` is empty). The sheet loaders catch
 * only this to degrade to the synthetic markers; any other error propagates.
 */
export class MissingAtlasError extends Error {}

/** Indexed sheets (the pipeline emits every one as `<stem>.indexed`) carry a palette index in red, so they
 *  must load straight-alpha. */
function isIndexedStem(stem: string): boolean {
  return stem.endsWith('.indexed');
}

/** Every decoded atlas body in flight or settled, by served stem. */
const layerBodies = new Map<string, Promise<SpriteLayer>>();

/**
 * One decoded atlas body (`<stem>.{atlas.json,png}`) served at `/bobs/`. A `build: true` manifest also reads
 * the sibling `<stem>.build.png` CPU-side for the per-pixel construction-reveal thresholds, degrading to the
 * crop reveal when unreadable.
 */
async function fetchLayerBody(stem: string): Promise<SpriteLayer> {
  const res = await fetch(`/bobs/${stem}.atlas.json`);
  if (!res.ok) {
    throw new MissingAtlasError(
      `atlas: decoded atlas '${stem}' not found (HTTP ${res.status}). Run \`npm run build:content\` to populate content/.`,
    );
  }
  const manifest = (await res.json()) as AtlasManifest;
  const [source, times] = await Promise.all([
    loadAtlasSource(`/bobs/${stem}.png`, 'nearest', isIndexedStem(stem) ? 'straight' : 'premultiplied'),
    manifest.build === true ? loadBuildTimeSheet(`/bobs/${stem}.build.png`) : Promise.resolve(undefined),
  ]);
  return { atlas: atlasFromManifest(manifest), source, ...(times !== undefined ? { times } : {}) };
}

/**
 * `fetchLayerBody` memoized per stem. Handing out the same instance is safe: `atlas.frames` is a
 * `ReadonlyMap`, nothing writes `times.values` once it is filled, and no consumer destroys an atlas page's
 * `TextureSource`.
 */
function loadLayerBody(stem: string): Promise<SpriteLayer> {
  const cached = layerBodies.get(stem);
  if (cached !== undefined) return cached;
  const pending = fetchLayerBody(stem);
  // Memoize only success, so a transient failure does not pin this stem to the fallback for the page's life.
  pending.catch(() => {
    if (layerBodies.get(stem) === pending) layerBodies.delete(stem);
  });
  layerBodies.set(stem, pending);
  return pending;
}

/**
 * One decoded atlas layer, optionally carrying the cast-shadow twin named by `shadowStem` (the pipeline's
 * `<shadow-bmd-stem>.shadow` atlas). A missing shadow degrades to a shadow-less layer rather than failing
 * the body.
 */
export async function loadLayer(stem: string, shadowStem?: string): Promise<SpriteLayer> {
  const shadowLoad =
    shadowStem === undefined
      ? undefined
      : loadLayerBody(shadowStem).catch((err: unknown) => {
          if (err instanceof MissingAtlasError) return undefined;
          throw err;
        });
  // Keep a shadow rejection from surfacing as unhandled while the body await is pending; the body's own
  // failure stays the one a caller sees.
  shadowLoad?.catch(() => undefined);
  const body = await loadLayerBody(stem);
  const shadow = await shadowLoad;
  return shadow === undefined ? body : { ...body, shadow };
}

/** Fetch a build-time sheet PNG and keep its R channel (the 0–255 thresholds) CPU-side, or `undefined`
 *  when absent/unreadable. */
async function loadBuildTimeSheet(url: string): Promise<BuildTimeSheet | undefined> {
  const img = await fetchImageData(url);
  if (img === null) return undefined;
  const values = new Uint8Array(img.width * img.height);
  for (let i = 0; i < values.length; i++) values[i] = img.data[i * 4] ?? 0;
  return { width: img.width, height: img.height, values };
}

/** The served player-colour LUT and the rows the pipeline stacked into it. */
export interface PlayerLut {
  readonly source: TextureSource;
  /** Total rows, the head row included. */
  readonly colours: number;
  /** The head palette row, the one after the player blocks. */
  readonly headRow: number;
}

/**
 * The player-colour LUT (`/bobs/player-lut.png`): one 16-row player block per armor tier, then one head
 * row, the layout `convertPlayerColorLut` writes. The row count comes from the texture's own height, not
 * a constant, so the shader's row lookup cannot desync from the PNG. `undefined` when the pipeline hasn't
 * produced it.
 */
export async function loadPlayerLut(): Promise<PlayerLut | undefined> {
  const source = await loadTextureIfPresent('/bobs/player-lut.png');
  if (source === undefined) return undefined;
  const colours = source.pixelHeight;
  return { source, colours, headRow: colours - 1 };
}

let contentIrPromise: Promise<unknown> | null = null;

/**
 * Fetch and parse the served `content/ir.json` once per page - memoized, because it is multi-MB and every
 * domain reads its lanes from the same bytes. Returns `null` when absent or unreadable.
 */
export function loadIrRaw(): Promise<unknown> {
  contentIrPromise ??= fetchJsonOrNull<unknown>('/ir.json').then((raw) => {
    // Memoize only success, so the next consumer retries after a transient boot-time fetch failure.
    if (raw === null) contentIrPromise = null;
    return raw;
  });
  return contentIrPromise;
}

/**
 * The graphics/atlas view of the served IR, cast at the I/O boundary. `null` when the document is absent;
 * each consumer then falls back per-lane.
 */
export async function loadIr(): Promise<ContentIr | null> {
  const raw = await loadIrRaw();
  return raw === null ? null : (raw as ContentIr);
}

/**
 * Every `[bobseq]` of one body bob set, in file order - the frame ranges only, not the atlas image.
 * Returns `[]` when the IR is absent.
 */
export async function loadBodyClips(imagelib: string = BODY_IMAGELIB): Promise<BobSeqRow[]> {
  const ir = await loadIr();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  return [...(set?.sequences ?? [])];
}

/**
 * A gallery character's layers: one body atlas plus N head atlases, given already-resolved served stems
 * (`<bmd-stem>.<palette>`, e.g. `cr_hum_body_05.test_human_00`). An absent body throws
 * `MissingAtlasError`; a missing head degrades to `undefined` in its `heads` slot, which keeps stem order.
 */
export async function loadGalleryLayers(
  bodyStem: string,
  headStems: readonly string[],
): Promise<{ body: SpriteLayer; heads: (SpriteLayer | undefined)[] }> {
  const bodyPromise = loadLayer(bodyStem);
  const headsPromise = Promise.all(
    headStems.map((s) =>
      loadLayer(s).catch((err: unknown) => {
        if (err instanceof MissingAtlasError) return undefined;
        throw err;
      }),
    ),
  );
  const [body, heads] = await Promise.all([bodyPromise, headsPromise]);
  return { body, heads };
}
