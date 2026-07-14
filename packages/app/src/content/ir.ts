import type {
  BuildingFootprint,
  GfxPattern,
  GfxPatternTransition,
  LandscapeBlockArea,
  SoundBank,
  TerrainPattern,
  TrianglePatternType,
} from '@open-northland/data';
import {
  type AtlasManifest,
  atlasFromManifest,
  type BuildTimeSheet,
  loadAtlasSource,
  type SpriteLayer,
  type TextureSource,
} from '@open-northland/render';
import { DOOR_SHIFTS } from '../catalog/building-tweaks.js';
import { fetchImageData, fetchJsonOrNull, loadTextureIfPresent } from './net.js';

/**
 * The decoded-content I/O layer for the served `content/ir.json` + `/bobs/` atlases: fetch the
 * gitignored `content/` (served by the dev/shot vite middleware) and hand back the raw atlas
 * geometry + IR row lists the pure binding reducers ({@link import('./settler-gfx/index.js')} /
 * {@link import('./building-gfx/index.js')}) turn into render inputs. No copyrighted bytes enter the repo;
 * a checkout without `content/` degrades gracefully (a missing atlas throws {@link MissingAtlasError};
 * a missing IR returns `null`).
 */

/**
 * The decoded atlas isn't served (the pipeline hasn't run / `content/` is empty) — an environment
 * precondition, distinct from a genuine decode bug. The sheet loaders catch only this to degrade to
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

/** One `[gfxanimatomic]` row as it ships in `content/ir.json`'s `gfxAtomics` — an atomic action's
 *  directional body-animation layout: `(tribe, job, action)` → the `bodySeq` bobseq + the per-facing
 *  {@link dirFrames} frame-index lists (the layout a bare bobseq range can't encode). See
 *  {@link gfxAtomicFrameLists}. */
export interface GfxAnimAtomicRow {
  readonly tribe: number;
  readonly job: number;
  readonly action: number;
  readonly bodySeq: string;
  readonly headSeq?: string;
  /** Per-facing ordered lists of local frame indices into the `bodySeq` pool (outer length = directions). */
  readonly dirFrames: readonly (readonly number[])[];
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

/** One `[GfxHouse]` type-4 `GfxOverlay` row as it ships in `content/ir.json`'s `buildingOverlays` —
 *  a finished building's animated state overlay (the mill rotor): `state` 0 = the idle still frame,
 *  `state` 1 = the working spin-cycle frames. */
export interface BuildingOverlayRow {
  readonly tribeId: number;
  readonly typeId: number;
  readonly level: number;
  readonly state: number;
  readonly x: number;
  readonly y: number;
  readonly step: number;
  readonly frames: readonly number[];
  readonly bmd: string;
  readonly paletteName: string;
  readonly editName?: string;
}

/** One `[GfxLandscape]` state's frame list as it ships in `content/ir.json`'s `landscapeGfx[].frames`. */
export interface LandscapeGfxFramesRow {
  readonly state: number;
  readonly bobIds: readonly number[];
}

/** One `[GfxLandscape]` record as it ships in `content/ir.json`'s `landscapeGfx` — the placed decor/resource
 *  object's atlas binding, keyed to a `[landscapetype]` by {@link logicType} (the gathering-pipeline join)
 *  and to a map placement by `editName` (the map-object join). The one app-side view of this lane — the
 *  gathering bindings read the id/frames half, the map-object loader additionally reads the draw flags. */
export interface LandscapeGfxRow {
  readonly index: number;
  readonly editName?: string;
  readonly logicType: number;
  readonly bmd?: string;
  readonly paletteName?: string;
  readonly frames?: readonly LandscapeGfxFramesRow[];
  /** `GfxStatic` — a still object (no per-frame playback). */
  readonly isStatic?: boolean;
  /** `GfxLoopAnimation` — the state's frame list loops continuously (waves, fire, smoke). */
  readonly loopAnimation?: boolean;
  /** Repeated `LogicWalkBlockArea` lines — a non-empty footprint marks a depth-sorted (non-decor) object. */
  readonly walkBlockAreas?: readonly Readonly<LandscapeBlockArea>[];
  /** Repeated `LogicBuildBlockArea` lines — the object's build-exclusion ring (the collision mask reads it). */
  readonly buildBlockAreas?: readonly Readonly<LandscapeBlockArea>[];
}

/** One resolved gathering-pipeline stage (a landscape type + the `landscapeGfx` records that place it). */
export interface GatheringStageRow {
  readonly landscapeType: number;
  readonly gfxIndices: readonly number[];
}

/** One good's resolved gathering pipeline as it ships in `content/ir.json`'s `gatheringPipeline` — the
 *  good→landscape→gfx join (`buildGatheringPipeline`) the render binds per good, keyed by {@link goodId}. */
export interface GatheringPipelineRow {
  readonly goodType: number;
  readonly goodId: string;
  readonly harvestAtomic?: number;
  readonly bioLandscape?: boolean;
  readonly harvest?: GatheringStageRow;
  readonly pickup?: GatheringStageRow;
  readonly store?: GatheringStageRow;
}

/** One `[landscapetype]` row as it ships in `content/ir.json`'s `landscape` — typeId + logic name. */
export interface LandscapeTypeRow {
  readonly typeId?: number;
  readonly name?: string;
}

/**
 * The app's view of the served `content/ir.json` — every lane any domain (sprites, terrain, map
 * objects, authored-entity joins, audio) reads, all optional: an `ir.json` generated before a lane
 * existed still loads, and each consumer degrades per-lane. The pipeline writes the file through the
 * `@open-northland/data` zod schema, so casting the fetched JSON to this view at the I/O boundary is the
 * boundary's stance (no re-validation of a multi-MB document per boot); the pattern/sound lanes use
 * the schema types directly, the bob/landscape lanes keep the narrower row views above.
 */
export interface ContentIr {
  readonly bobSequences?: readonly { imagelib: string; sequences?: BobSeqRow[] }[];
  readonly gfxAtomics?: readonly GfxAnimAtomicRow[];
  readonly buildingBobs?: readonly BuildingBobRow[];
  readonly constructionLayers?: readonly ConstructionLayerRow[];
  readonly buildingOverlays?: readonly BuildingOverlayRow[];
  readonly gatheringPipeline?: readonly GatheringPipelineRow[];
  readonly landscapeGfx?: readonly LandscapeGfxRow[];
  /** The `[landscapetype]` logic table — the {@link LandscapeGfxRow.logicType} join key. */
  readonly landscape?: readonly LandscapeTypeRow[];
  /** The approximated per-typeId ground binding (`buildTerrainPatterns`) the terrain renderer reads. */
  readonly terrainPatterns?: readonly TerrainPattern[];
  /** The full 927-record `[GfxPattern]` table — the 1:1 per-triangle ground join for decoded maps. */
  readonly gfxPatterns?: readonly GfxPattern[];
  /** The `[transition]` ground-overlay table — a decoded map's `transitions.types` names join onto it. */
  readonly gfxPatternTransitions?: readonly GfxPatternTransition[];
  /** The per-logicType ground classes (`trianglepatterntypes.cif`) — the walk/build flags the
   *  map-collision join (`content/collision.ts`) classes real ground by. */
  readonly trianglePatternTypes?: readonly TrianglePatternType[];
  /** Type-table views the authored-entity joins read (`resolveAuthoredPlacements`) + the extracted
   *  ground `footprint` (collision body / build-exclusion zone / door) the live content attaches so the
   *  real-content view actually enforces + shows placement collision ({@link buildingFootprints}). */
  readonly buildings?: readonly {
    typeId?: number;
    id?: string;
    kind?: string;
    footprint?: BuildingFootprint;
  }[];
  readonly jobs?: readonly { typeId?: number; id?: string; name?: string }[];
  readonly tribes?: readonly { typeId?: number; id?: string }[];
  /** The decoded sound bank (`@open-northland/audio` builds its index from it). */
  readonly sounds?: SoundBank;
}

/** The `[bobseq]` imagelib whose sequences drive the settler — the body bob set the head atlas shares ids with. */
export const BODY_IMAGELIB = 'cr_hum_body_00.bmd';

/**
 * Load one decoded atlas layer (`<stem>.{atlas.json,png}`) from the gitignored `content/` (served at
 * `/bobs/`): the manifest → in-memory frame geometry, the PNG → a GPU texture. A manifest that
 * announces a build-time sheet (`build: true`, the house atlases) also fetches the sibling
 * `<stem>.build.png` CPU-side — the per-pixel construction-reveal thresholds; an unreadable build
 * sheet just degrades that layer to the crop reveal. Throws {@link MissingAtlasError} when the decoded
 * files are missing.
 */
export async function loadLayer(stem: string): Promise<SpriteLayer> {
  const res = await fetch(`/bobs/${stem}.atlas.json`);
  if (!res.ok) {
    throw new MissingAtlasError(
      `atlas: decoded atlas '${stem}' not found (HTTP ${res.status}). Run \`npm run pipeline\` against an owned game copy to populate content/.`,
    );
  }
  const manifest = (await res.json()) as AtlasManifest;
  const [source, times] = await Promise.all([
    loadAtlasSource(`/bobs/${stem}.png`),
    manifest.build === true ? loadBuildTimeSheet(`/bobs/${stem}.build.png`) : Promise.resolve(undefined),
  ]);
  return { atlas: atlasFromManifest(manifest), source, ...(times !== undefined ? { times } : {}) };
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

/** The one in-flight/settled `ir.json` fetch — every domain shares it (see {@link loadIr}). */
let contentIrPromise: Promise<ContentIr | null> | null = null;

/**
 * Fetch + parse the served `content/ir.json` once per page — memoized, because the document is multi-MB
 * and the sprite, terrain, map-object and audio domains all read their lanes from it. Returns `null` when
 * it is absent or unparsable; unlike a missing atlas (which {@link loadLayer} throws on), a missing IR
 * degrades gracefully and each consumer falls back per-lane. Browser-only: the memo lives for the page's
 * lifetime (tests never call this).
 */
export function loadIr(): Promise<ContentIr | null> {
  contentIrPromise ??= fetchJsonOrNull<ContentIr>('/ir.json').then((ir) => {
    // Memoize only success: a transient boot-time fetch failure must not pin every domain (terrain,
    // objects, sprites, audio) to the fallback for the page's lifetime — the next consumer retries.
    if (ir === null) contentIrPromise = null;
    return ir;
  });
  return contentIrPromise;
}

/**
 * The extracted building ground footprints from the served IR, by typeId — the collision/build-exclusion
 * data live content attaches so the real-content view (`?map=`) enforces and shows placement collision
 * (scenes and bare checkouts stay footprint-less, keeping free placement). Empty when the IR is absent or
 * carries no footprints. Door cells get the committed per-building {@link DOOR_SHIFTS} applied here — the
 * one seam extracted footprints pass through — so the sim's walk-to-door target and the `?debug=geometry`
 * overlay read the same corrected door.
 */
export function buildingFootprints(ir: ContentIr | null): Map<number, BuildingFootprint> {
  const out = new Map<number, BuildingFootprint>();
  for (const b of ir?.buildings ?? []) {
    if (b.typeId === undefined || b.footprint === undefined) continue;
    const shift = b.id !== undefined ? DOOR_SHIFTS.get(b.id) : undefined;
    const door = b.footprint.door;
    if (shift !== undefined && door === undefined) {
      // A committed correction with nothing to correct — a re-extraction dropped the door. Warn so the
      // review-signed shift isn't silently lost (the type still gets its verbatim footprint).
      console.warn(`buildingFootprints: DOOR_SHIFTS['${b.id}'] has no extracted door to shift`);
    }
    out.set(
      b.typeId,
      shift !== undefined && door !== undefined
        ? { ...b.footprint, door: { dx: door.dx + shift.dx, dy: door.dy + shift.dy } }
        : b.footprint,
    );
  }
  return out;
}

/** The `[bobseq]` rows of one imagelib in the served IR, indexed by verbatim sequence name. */
export function sequencesFor(ir: ContentIr | null, imagelib: string): Map<string, BobSeqRow> {
  const byName = new Map<string, BobSeqRow>();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  for (const seq of set?.sequences ?? []) byName.set(seq.name, seq);
  return byName;
}

/**
 * The `[gfxanimatomic]` per-direction frame lists for one `(tribe, action)`, indexed by body bobseq name
 * — the directional action layout a bare bobseq range can't encode ({@link GfxAnimAtomicRow.dirFrames}).
 * First record wins per seq (a job/action may list several variant seqs — the unarmed soldier's four
 * punches; the caller names the one it wants). Filtering by `tribe` matters: the same body bobseq name
 * recurs across the human tribes with different frame lists (each tribe's own swing layout), so passing
 * the wrong tribe yields a plausible-but-wrong animation. `tribe` is the `[gfxanimatomic]` `logictribe`
 * (= the `logicdefines.inc` `TRIBE_TYPE_*`; viking 1).
 */
export function gfxAtomicFrameLists(
  ir: ContentIr | null,
  tribe: number,
  action: number,
): Map<string, readonly (readonly number[])[]> {
  const byName = new Map<string, readonly (readonly number[])[]>();
  for (const row of ir?.gfxAtomics ?? []) {
    if (row.tribe !== tribe || row.action !== action) continue;
    if (!byName.has(row.bodySeq)) byName.set(row.bodySeq, row.dirFrames);
  }
  return byName;
}

/**
 * Load every `[bobseq]` of one body bob set (default {@link BODY_IMAGELIB}) from the served
 * `content/ir.json`, in file order — the raw animation list the {@link import('@open-northland/render').AnimationGallery}
 * plays. Returns `[]` when the IR is absent (a checkout without `content/`), so the gallery can show a
 * "run the pipeline" message instead of crashing. The atlas *image* is loaded separately
 * ({@link import('./sprite-sheet/index.js').loadHumanSpriteSheet}); this is only the frame ranges the gallery indexes.
 */
export async function loadBodyClips(imagelib: string = BODY_IMAGELIB): Promise<BobSeqRow[]> {
  const ir = await loadIr();
  const set = (ir?.bobSequences ?? []).find((s) => s.imagelib === imagelib);
  return [...(set?.sequences ?? [])];
}

/**
 * Load a gallery character's layers: one body atlas + N head atlases, given the already-resolved served
 * stems (`<bmd-stem>.<palette>`, e.g. `cr_hum_body_05.test_human_00`) — the only human loader the animation
 * gallery (`?anim`) needs. Unlike {@link import('./sprite-sheet/index.js').loadHumanSpriteSheet} it does not pull in
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
