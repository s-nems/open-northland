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
 * The decoded-content I/O layer for the served `content/ir.json` + `/bobs/` atlases: fetch the
 * gitignored `content/` (served by the dev/shot vite middleware) and hand back the raw atlas
 * geometry + IR row lists the pure binding reducers ({@link import('../settler-gfx/index.js')} /
 * {@link import('../building-gfx/index.js')}) turn into render inputs. No copyrighted bytes enter the repo;
 * a checkout without `content/` degrades gracefully (a missing atlas throws {@link MissingAtlasError};
 * a missing IR returns `null`). The only module in `content/ir/` that reaches the network or the
 * renderer: `rows.ts` and `joins.ts` stay free of both so a join can be driven headlessly.
 */

/**
 * The decoded atlas isn't served (the pipeline hasn't run / `content/` is empty) — an environment
 * precondition, distinct from a genuine decode bug. The sheet loaders catch only this to degrade to
 * the synthetic markers; any other error (a bad manifest, a texture-load failure) propagates so a real
 * bug surfaces instead of being silently masked as "missing content".
 */
export class MissingAtlasError extends Error {}

/** Whether a served atlas stem names a palette-indexed sheet (the pipeline emits every one as
 *  `<stem>.indexed` — characters, GUI, fonts, goods). Indexed sheets carry a palette INDEX in red, so
 *  they must load straight-alpha (`loadAtlasSource`'s `'straight'`). */
function isIndexedStem(stem: string): boolean {
  return stem.endsWith('.indexed');
}

/** Every decoded atlas body ({@link loadLayerBody}) in flight or settled, by served stem. */
const layerBodies = new Map<string, Promise<SpriteLayer>>();

/**
 * One decoded atlas body (`<stem>.{atlas.json,png}`) from the gitignored `content/` (served at
 * `/bobs/`): the manifest → in-memory frame geometry, the PNG → a GPU texture. A `build: true` manifest
 * (the house atlases) also reads the sibling `<stem>.build.png` CPU-side — the per-pixel
 * construction-reveal thresholds, degrading to the crop reveal when unreadable. Throws
 * {@link MissingAtlasError} when the decoded files are missing.
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
    // Indexed sheets must load straight-alpha: premultiply would corrupt the palette index in red
    // (see `loadAtlasSource`); the `.indexed` stem suffix is the pipeline's naming contract for them.
    loadAtlasSource(`/bobs/${stem}.png`, 'nearest', isIndexedStem(stem) ? 'straight' : 'premultiplied'),
    manifest.build === true ? loadBuildTimeSheet(`/bobs/${stem}.build.png`) : Promise.resolve(undefined),
  ]);
  return { atlas: atlasFromManifest(manifest), source, ...(times !== undefined ? { times } : {}) };
}

/**
 * {@link fetchLayerBody} memoized per stem, so domains that share a stem decode it once per page.
 * Handing out the same instance is safe: `atlas.frames` is a `ReadonlyMap`, nothing writes
 * `times.values` after {@link loadBuildTimeSheet} fills it, and no consumer destroys an atlas page's
 * `TextureSource`.
 */
function loadLayerBody(stem: string): Promise<SpriteLayer> {
  const cached = layerBodies.get(stem);
  if (cached !== undefined) return cached;
  const pending = fetchLayerBody(stem);
  // Memoize only success: a transient boot-time failure must not pin every later consumer of this stem
  // to the fallback for the page's lifetime (the stance {@link loadIrRaw} takes on the IR document).
  pending.catch(() => {
    if (layerBodies.get(stem) === pending) layerBodies.delete(stem);
  });
  layerBodies.set(stem, pending);
  return pending;
}

/**
 * One decoded atlas layer ({@link loadLayerBody}), optionally carrying the cast-shadow twin named by
 * `shadowStem` (the pipeline's `<shadow-bmd-stem>.shadow` atlas — see
 * {@link import('./joins.js').servedShadowStem}). A missing shadow degrades to a shadow-less layer,
 * never fails the body. Body and shadow cache separately, so the same stem asked for with and without
 * a twin still decodes each sheet once.
 */
export async function loadLayer(stem: string, shadowStem?: string): Promise<SpriteLayer> {
  const shadowLoad =
    shadowStem === undefined
      ? undefined
      : loadLayerBody(shadowStem).catch((err: unknown) => {
          if (err instanceof MissingAtlasError) return undefined;
          throw err;
        });
  // A shadow rejection must wait for the body await below, not surface as unhandled while it is pending
  // — and the body's own failure stays the one a caller sees, so `MissingAtlasError` still names the
  // stem the caller asked for.
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
 * Load the player-colour LUT texture (`/bobs/player-lut.png`, a `256 × colours` sheet) that the paletted
 * character atlases are read through. Returns `undefined` when the pipeline hasn't produced it (a checkout
 * without `content/`), so a caller degrades to the baked-palette gallery instead of crashing.
 */
export function loadPlayerLut(): Promise<TextureSource | undefined> {
  return loadTextureIfPresent('/bobs/player-lut.png');
}

/** The one in-flight/settled `ir.json` fetch — every domain shares it (see {@link loadIrRaw}). */
let contentIrPromise: Promise<unknown> | null = null;

/**
 * Fetch + parse the served `content/ir.json` document once per page — memoized, because it is multi-MB
 * and both views of it (the graphics {@link loadIr} and the sim-side
 * {@link import('../real-content.js').loadRealContent}) plus the terrain, map-object and audio domains all
 * read their lanes from the same bytes. Returns `null` when absent or unreadable. The memo lives for the
 * page's lifetime.
 */
export function loadIrRaw(): Promise<unknown> {
  contentIrPromise ??= fetchJsonOrNull<unknown>('/ir.json').then((raw) => {
    // Memoize only success: a transient boot-time fetch failure must not pin every domain (terrain,
    // objects, sprites, audio) to the fallback for the page's lifetime — the next consumer retries.
    if (raw === null) contentIrPromise = null;
    return raw;
  });
  return contentIrPromise;
}

/**
 * The graphics/atlas view of the served IR ({@link loadIrRaw}), cast at the I/O boundary per
 * {@link ContentIr}'s stance. Returns `null` when the document is absent; unlike a missing atlas (which
 * {@link loadLayer} throws on), a missing IR degrades gracefully and each consumer falls back per-lane.
 */
export async function loadIr(): Promise<ContentIr | null> {
  const raw = await loadIrRaw();
  return raw === null ? null : (raw as ContentIr);
}

/**
 * Load every `[bobseq]` of one body bob set (default {@link BODY_IMAGELIB}) from the served
 * `content/ir.json`, in file order — the raw animation list the {@link import('@open-northland/render').AnimationGallery}
 * plays. Returns `[]` when the IR is absent (a checkout without `content/`), so the gallery can show a
 * "run the pipeline" message instead of crashing. The atlas *image* is loaded separately
 * ({@link import('../sprite-sheet/index.js').loadHumanSpriteSheet}); this is only the frame ranges the gallery indexes.
 */
export async function loadBodyClips(imagelib: string = BODY_IMAGELIB): Promise<BobSeqRow[]> {
  const ir = await loadIr();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  return [...(set?.sequences ?? [])];
}

/**
 * Load a gallery character's layers: one body atlas + N head atlases, given the already-resolved served
 * stems (`<bmd-stem>.<palette>`, e.g. `cr_hum_body_05.test_human_00`) — the only human loader the animation
 * gallery (`?anim`) needs. Unlike {@link import('../sprite-sheet/index.js').loadHumanSpriteSheet} it does not pull in
 * the tree / house / building-family atlases (a gallery never draws them), so a partial `content/` still opens
 * the gallery.
 *
 * The body is the hard requirement — an absent body throws {@link MissingAtlasError}. A missing head
 * degrades to `undefined` (its slot in `heads`) rather than failing the whole character: the animation
 * view needs only `heads[0]`, and the roster/heads montages skip an absent look, so one 404'd head can't
 * drop a body that decoded fine. `heads` preserves stem order, so it lines up 1:1 with the character's
 * head list; a body-only character (empty `headStems`) gets `[]`.
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
