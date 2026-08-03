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
 * The decoded-content I/O layer for the served `content/ir.json` and `/bobs/` atlases: fetch the gitignored
 * `content/` and hand back the raw atlas geometry and IR row lists the pure binding reducers turn into
 * render inputs. A checkout without `content/` degrades gracefully - a missing atlas throws
 * {@link MissingAtlasError}, a missing IR returns `null`. The only module in `content/ir/` that reaches the
 * network or the renderer; `rows.ts` and `joins.ts` stay free of both so a join can be driven headlessly.
 */

/**
 * The decoded atlas isn't served (the pipeline hasn't run, or `content/` is empty) - an environment
 * precondition, distinct from a genuine decode bug. The sheet loaders catch only this to degrade to the
 * synthetic markers; any other error propagates instead of being masked as "missing content".
 */
export class MissingAtlasError extends Error {}

/** Whether a served atlas stem names a palette-indexed sheet (the pipeline emits every one as
 *  `<stem>.indexed`). Indexed sheets carry a palette index in red, so they must load straight-alpha. */
function isIndexedStem(stem: string): boolean {
  return stem.endsWith('.indexed');
}

/** Every decoded atlas body ({@link loadLayerBody}) in flight or settled, by served stem. */
const layerBodies = new Map<string, Promise<SpriteLayer>>();

/**
 * One decoded atlas body (`<stem>.{atlas.json,png}`) served at `/bobs/`: the manifest becomes in-memory
 * frame geometry, the PNG a GPU texture. A `build: true` manifest also reads the sibling
 * `<stem>.build.png` CPU-side for the per-pixel construction-reveal thresholds, degrading to the crop
 * reveal when unreadable. Throws {@link MissingAtlasError} when the decoded files are missing.
 */
async function fetchLayerBody(stem: string): Promise<SpriteLayer> {
  const res = await fetch(`/bobs/${stem}.atlas.json`);
  if (!res.ok) {
    throw new MissingAtlasError(
      `atlas: decoded atlas '${stem}' not found (HTTP ${res.status}). Run \`npm run pipeline\` against an owned game copy to populate content/.`,
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
 * {@link fetchLayerBody} memoized per stem, so domains that share a stem decode it once per page. Handing
 * out the same instance is safe: `atlas.frames` is a `ReadonlyMap`, nothing writes `times.values` after
 * {@link loadBuildTimeSheet} fills it, and no consumer destroys an atlas page's `TextureSource`.
 */
function loadLayerBody(stem: string): Promise<SpriteLayer> {
  const cached = layerBodies.get(stem);
  if (cached !== undefined) return cached;
  const pending = fetchLayerBody(stem);
  // Memoize only success: a transient boot-time failure must not pin later consumers of this stem to the
  // fallback for the page's lifetime.
  pending.catch(() => {
    if (layerBodies.get(stem) === pending) layerBodies.delete(stem);
  });
  layerBodies.set(stem, pending);
  return pending;
}

/**
 * One decoded atlas layer, optionally carrying the cast-shadow twin named by `shadowStem` (the pipeline's
 * `<shadow-bmd-stem>.shadow` atlas). A missing shadow degrades to a shadow-less layer rather than failing
 * the body. Body and shadow cache separately.
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
  // failure stays the one a caller sees, so `MissingAtlasError` still names the stem it asked for.
  shadowLoad?.catch(() => undefined);
  const body = await loadLayerBody(stem);
  const shadow = await shadowLoad;
  return shadow === undefined ? body : { ...body, shadow };
}

/** Fetch a build-time sheet PNG and keep its R channel (the 0–255 thresholds) CPU-side, or `undefined`
 *  when absent/unreadable (the layer degrades to the crop reveal). */
async function loadBuildTimeSheet(url: string): Promise<BuildTimeSheet | undefined> {
  const img = await fetchImageData(url);
  if (img === null) return undefined;
  const values = new Uint8Array(img.width * img.height);
  for (let i = 0; i < values.length; i++) values[i] = img.data[i * 4] ?? 0;
  return { width: img.width, height: img.height, values };
}

/**
 * The player-colour LUT texture (`/bobs/player-lut.png`, a `256 × colours` sheet) the paletted character
 * atlases are read through. `undefined` when the pipeline hasn't produced it, so a caller degrades to the
 * baked-palette gallery instead of crashing.
 */
export function loadPlayerLut(): Promise<TextureSource | undefined> {
  return loadTextureIfPresent('/bobs/player-lut.png');
}

/** The one in-flight/settled `ir.json` fetch - every domain shares it (see {@link loadIrRaw}). */
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
 * The graphics/atlas view of the served IR, cast at the I/O boundary per {@link ContentIr}'s stance.
 * `null` when the document is absent; unlike a missing atlas, each consumer then falls back per-lane.
 */
export async function loadIr(): Promise<ContentIr | null> {
  const raw = await loadIrRaw();
  return raw === null ? null : (raw as ContentIr);
}

/**
 * Every `[bobseq]` of one body bob set (default {@link BODY_IMAGELIB}) from the served `content/ir.json`,
 * in file order - the frame ranges only, not the atlas image. Returns `[]` when the IR is absent, so the
 * gallery can show a "run the pipeline" message instead of crashing.
 */
export async function loadBodyClips(imagelib: string = BODY_IMAGELIB): Promise<BobSeqRow[]> {
  const ir = await loadIr();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  return [...(set?.sequences ?? [])];
}

/**
 * A gallery character's layers: one body atlas plus N head atlases, given already-resolved served stems
 * (`<bmd-stem>.<palette>`, e.g. `cr_hum_body_05.test_human_00`). It pulls in no tree/house/family atlases,
 * so a partial `content/` still opens the gallery.
 *
 * The body is the hard requirement and an absent one throws {@link MissingAtlasError}. A missing head
 * degrades to `undefined` in its `heads` slot rather than failing the whole character. `heads` preserves
 * stem order, so it lines up 1:1 with the character's head list.
 */
export async function loadGalleryLayers(
  bodyStem: string,
  headStems: readonly string[],
): Promise<{ body: SpriteLayer; heads: (SpriteLayer | undefined)[] }> {
  const bodyPromise = loadLayer(bodyStem);
  const headsPromise = Promise.all(
    headStems.map((s) =>
      loadLayer(s).catch((err: unknown) => {
        if (err instanceof MissingAtlasError) return undefined; // a missing head just isn't drawn
        throw err;
      }),
    ),
  );
  const [body, heads] = await Promise.all([bodyPromise, headsPromise]);
  return { body, heads };
}
