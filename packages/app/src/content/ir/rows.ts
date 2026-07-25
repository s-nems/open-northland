import type {
  BuildingFootprint,
  GfxPattern,
  GfxPatternTransition,
  LandscapeBlockArea,
  SoundBank,
  TerrainPattern,
  TrianglePatternType,
} from '@open-northland/data';

/** One decoded `[bobseq]` sequence as it ships in `content/ir.json`'s `bobSequences`. */
export interface BobSeqRow {
  readonly name: string;
  readonly start: number;
  readonly length: number;
}

/** One `[gfxanimatomic]` row as it ships in `content/ir.json`'s `gfxAtomics` — an atomic action's
 *  directional body-animation layout: `(tribe, job, action)` → the `bodySeq` bobseq + the per-facing
 *  {@link dirFrames} frame-index lists (the layout a bare bobseq range can't encode). See
 *  {@link import('./joins.js').gfxAtomicFrameLists}. */
export interface GfxAnimAtomicRow {
  readonly tribe: number;
  readonly job: number;
  readonly action: number;
  readonly bodySeq: string;
  readonly headSeq?: string;
  /** Per-facing ordered lists of local frame indices into the `bodySeq` pool (outer length = directions). */
  readonly dirFrames: readonly (readonly number[])[];
}

/** One `[gfxwalkatomic]` row as it ships in `content/ir.json`'s `gfxWalkAtomics` — the original's
 *  loaded-gait table: `(tribe, job, goodType)` → the `bodySeq` bobseq a hauler plays carrying that good.
 *  See {@link import('./joins.js').carryWalkSeqs}. */
export interface GfxWalkAtomicRow {
  readonly tribe: number;
  readonly job: number;
  readonly goodType: number;
  readonly bodySeq: string;
  readonly headSeq?: string;
}

/** One good as it ships in `content/ir.json`'s `goods` — only the id join the graphics lanes need. */
export interface IrGoodRow {
  readonly typeId: number;
  readonly id: string;
}

/** One `[GfxHouse]` `LogicType`→`GfxBobId` row as it ships in `content/ir.json`'s `buildingBobs`. */
export interface BuildingBobRow {
  readonly tribeId: number;
  readonly typeId: number;
  readonly level: number;
  readonly bmd: string;
  /** The shadow bob set (`GfxBobLibs` second value) — its silhouettes parallel the body's bob ids. */
  readonly shadowBmd?: string;
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
  /** The shadow bob set (`GfxBobLibs` second value) — its silhouettes parallel the body's bob ids. */
  readonly shadowBmd?: string;
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
  readonly gfxWalkAtomics?: readonly GfxWalkAtomicRow[];
  readonly goods?: readonly IrGoodRow[];
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
   *  real-content view actually enforces + shows placement collision
   *  ({@link import('./joins.js').buildingFootprints}). */
  readonly buildings?: readonly {
    typeId?: number;
    id?: string;
    kind?: string;
    footprint?: BuildingFootprint;
  }[];
  readonly jobs?: readonly { typeId?: number; id?: string; name?: string }[];
  readonly tribes?: readonly { typeId?: number; id?: string }[];
  /** The `animaltypes.ini` records, read only for tribe membership: which tribes ARE animals (the
   *  species-look and authored-placement joins key on `tribeType`; behaviour fields stay sim-side). */
  readonly animals?: readonly { tribeType?: number }[];
  /** The decoded sound bank (`@open-northland/audio` builds its index from it). */
  readonly sounds?: SoundBank;
}

/** The `[bobseq]` imagelib whose sequences drive the settler — the body bob set the head atlas shares ids with. */
export const BODY_IMAGELIB = 'cr_hum_body_00.bmd';
