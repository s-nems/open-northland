import { type AtlasManifest, type SpriteLayer, atlasFromManifest, loadAtlasSource } from '@vinland/render';

/**
 * The decoded-content I/O layer for the settler/building bindings: fetch the gitignored `content/`
 * (served at `/bobs/` + `/ir.json` by the dev/shot vite middleware) and hand back the raw atlas
 * geometry + IR row lists the pure binding reducers ({@link import('./settler-gfx.js')} /
 * {@link import('./building-gfx.js')}) turn into render inputs. No copyrighted bytes enter the repo;
 * a checkout without `content/` degrades gracefully (a missing atlas throws {@link MissingAtlasError};
 * a missing IR returns `null`).
 */

/**
 * The decoded atlas isn't served (the pipeline hasn't run / `content/` is empty) — an ENVIRONMENT
 * precondition, distinct from a genuine decode bug. The sheet loaders catch ONLY this to degrade to
 * the synthetic markers; any other error (a bad manifest, a texture-load failure) propagates so a real
 * bug surfaces instead of being silently masked as "missing content".
 */
export class MissingAtlasError extends Error {}

/** One decoded `[bobseq]` sequence as it ships in `content/ir.json`'s `bobSequences`. */
export interface BobSeqRow {
  readonly name: string;
  readonly start: number;
  readonly length: number;
}

/** One `[GfxHouse]` `LogicType`→`GfxBobId` row as it ships in `content/ir.json`'s `buildingBobs`. */
export interface BuildingBobRow {
  readonly tribeId: number;
  readonly typeId: number;
  readonly level: number;
  readonly bmd: string;
  readonly paletteName: string;
  readonly bobId: number;
  readonly editName?: string;
}

/** One `[GfxHouse]` `GfxBobConstructionLayer` row as it ships in `content/ir.json`'s `constructionLayers`. */
export interface ConstructionLayerRow {
  readonly tribeId: number;
  readonly typeId: number;
  readonly level: number;
  readonly upgrade: boolean;
  readonly stackIdx: number;
  readonly bmd: string;
  readonly paletteName: string;
  readonly bobId: number;
  readonly fromPct: number;
  readonly toPct: number;
  readonly editName?: string;
}

/** The render-binding lanes the real-graphics path reads from the served `content/ir.json`. */
export interface RenderIr {
  readonly bobSequences?: readonly { imagelib: string; sequences?: BobSeqRow[] }[];
  readonly buildingBobs?: readonly BuildingBobRow[];
  readonly constructionLayers?: readonly ConstructionLayerRow[];
}

/** The `[bobseq]` imagelib whose sequences drive the settler — the body bob set the head atlas shares ids with. */
export const BODY_IMAGELIB = 'cr_hum_body_00.bmd';

/**
 * Load one decoded atlas layer (`<stem>.{atlas.json,png}`) from the gitignored `content/` (served at
 * `/bobs/`): the manifest → in-memory frame geometry, the PNG → a GPU texture. Throws
 * {@link MissingAtlasError} if the decoded files are missing (the pipeline hasn't been run / `content/`
 * is empty) — an environment precondition the caller may recover from; other failures throw as-is.
 */
export async function loadLayer(stem: string): Promise<SpriteLayer> {
  const res = await fetch(`/bobs/${stem}.atlas.json`);
  if (!res.ok) {
    throw new MissingAtlasError(
      `atlas: decoded atlas '${stem}' not found (HTTP ${res.status}). Run \`npm run pipeline\` against an owned game copy to populate content/.`,
    );
  }
  const manifest = (await res.json()) as AtlasManifest;
  return { atlas: atlasFromManifest(manifest), source: await loadAtlasSource(`/bobs/${stem}.png`) };
}

/**
 * Fetch + parse the served `content/ir.json` ONCE (both the settler `[bobseq]` ranges and the building
 * `buildingBobs` join read from it). Returns `null` when it is absent or unparsable — unlike a missing
 * atlas (a hard precondition {@link loadLayer} throws on), a missing IR degrades gracefully: the settler
 * ranges fall back to the known-good `FALLBACK_*` and the house bobs to the transcribed constant, so the
 * real-graphics path still draws correctly on a checkout without `content/`.
 */
export async function loadIr(): Promise<RenderIr | null> {
  try {
    const res = await fetch('/ir.json');
    if (!res.ok) return null;
    return (await res.json()) as RenderIr;
  } catch {
    return null;
  }
}

/** The `[bobseq]` rows of ONE imagelib in the served IR, indexed by verbatim sequence name. */
export function sequencesFor(ir: RenderIr | null, imagelib: string): Map<string, BobSeqRow> {
  const byName = new Map<string, BobSeqRow>();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  for (const seq of set?.sequences ?? []) byName.set(seq.name, seq);
  return byName;
}

/**
 * Load every `[bobseq]` of one body bob set (default {@link BODY_IMAGELIB}) from the served
 * `content/ir.json`, in file order — the raw animation list the {@link import('@vinland/render').AnimationGallery}
 * plays. Returns `[]` when the IR is absent (a checkout without `content/`), so the gallery can show a
 * "run the pipeline" message instead of crashing. The atlas *image* is loaded separately
 * ({@link import('./sprite-sheet.js').loadHumanSpriteSheet}); this is only the frame RANGES the gallery indexes.
 */
export async function loadBodyClips(imagelib: string = BODY_IMAGELIB): Promise<BobSeqRow[]> {
  const ir = await loadIr();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  return [...(set?.sequences ?? [])];
}

/**
 * Load a gallery character's layers: one body atlas + N head atlases, given the already-resolved served
 * stems (`<bmd-stem>.<palette>`, e.g. `cr_hum_body_05.test_human_00`) — the only human loader the animation
 * gallery (`?anim`) needs. Unlike {@link import('./sprite-sheet.js').loadHumanSpriteSheet} it does NOT pull in
 * the tree / house / building-family atlases (a gallery never draws them), so a partial `content/` still opens
 * the gallery.
 *
 * The **body is the hard requirement** — an absent body throws {@link MissingAtlasError} (the precondition
 * the caller degrades on). A **missing HEAD degrades to `undefined`** (its slot in `heads`) rather than
 * failing the whole character: the animation view needs only `heads[0]`, and the roster/heads montages skip
 * an absent look, so one 404'd head can't drop a body that decoded fine. `heads` preserves stem order, so
 * it lines up 1:1 with the character's head list; a body-only character (empty `headStems`) gets `[]`. Any
 * non-precondition error (a bad manifest, a texture-load failure) still propagates.
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
