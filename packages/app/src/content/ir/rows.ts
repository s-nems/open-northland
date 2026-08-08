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

/** One `[gfxanimatomic]` row as it ships in `content/ir.json`'s `gfxAtomics` - an atomic action's
 *  directional body-animation layout: `(tribe, job, action)` → the `bodySeq` bobseq plus the per-facing
 *  {@link dirFrames} frame-index lists a bare bobseq range cannot encode. */
export interface GfxAnimAtomicRow {
  readonly tribe: number;
  readonly job: number;
  readonly action: number;
  readonly bodySeq: string;
  readonly headSeq?: string;
  /** Per-facing ordered lists of local frame indices into the `bodySeq` pool (outer length = directions). */
  readonly dirFrames: readonly (readonly number[])[];
  /** `gfxanimmode` - `1` marks a body's looping base wait; `0` is a one-shot motion. */
  readonly mode?: number;
}

/** One `[gfxwalkatomic]` row as it ships in `content/ir.json`'s `gfxWalkAtomics` - the original's
 *  loaded-gait table: `(tribe, job, goodType)` → the `bodySeq` bobseq a hauler plays carrying that good. */
export interface GfxWalkAtomicRow {
  readonly tribe: number;
  readonly job: number;
  readonly goodType: number;
  readonly bodySeq: string;
  readonly headSeq?: string;
  /** Per-facing `gfxwalkframelist` lists of local frame indices into the `bodySeq` pool. */
  readonly dirFrames?: readonly (readonly number[])[];
  /** `logicwalkspeed` - the gait's authored speed rating; no consumer yet. */
  readonly walkSpeed?: number;
}

/** One good as it ships in `content/ir.json`'s `goods` - only the id join the graphics lanes need. */
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
  /** The shadow bob set (`GfxBobLibs` second value) - its silhouettes parallel the body's bob ids. */
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

/** One `[GfxHouse]` type-4 `GfxOverlay` row as it ships in `content/ir.json`'s `buildingOverlays` -
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

/** One `[GfxHouse]` `GfxFlagPoint` row as it ships in `content/ir.json`'s `buildingFlagPoints` - where
 *  the original plants the building's sign chain, in screen px from the building bob's draw anchor
 *  (+y down). */
export interface BuildingFlagPointRow {
  readonly tribeId: number;
  readonly typeId: number;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly editName?: string;
}

/** One `[GfxLandscape]` state's frame list as it ships in `content/ir.json`'s `landscapeGfx[].frames`. */
export interface LandscapeGfxFramesRow {
  readonly state: number;
  readonly bobIds: readonly number[];
}

/** One `[GfxLandscape]` record as it ships in `content/ir.json`'s `landscapeGfx` - the placed decor/resource
 *  object's atlas binding, keyed to a `[landscapetype]` by {@link logicType} (the gathering-pipeline join)
 *  and to a map placement by `editName` (the map-object join). */
export interface LandscapeGfxRow {
  readonly index: number;
  readonly editName?: string;
  /** `EditGroups`, the editor palette folders the record sits in (`ir/joins.ts` `BRIDGE_EDIT_GROUP`). */
  readonly editGroups?: readonly string[];
  readonly logicType: number;
  /** `LogicMaximumValency` - the record's harvest capacity in units, which sizes a spawned mineral
   *  deposit. Not the authored {@link frames} count. */
  readonly maxValency?: number;
  readonly bmd?: string;
  /** The shadow bob set (`GfxBobLibs` second value) - its silhouettes parallel the body's bob ids. */
  readonly shadowBmd?: string;
  readonly paletteName?: string;
  readonly frames?: readonly LandscapeGfxFramesRow[];
  /** `GfxStatic` - a still object (no per-frame playback). */
  readonly isStatic?: boolean;
  /** `GfxLoopAnimation` - the state's frame list loops continuously (waves, fire, smoke). */
  readonly loopAnimation?: boolean;
  /** Repeated `LogicWalkBlockArea` lines - a non-empty footprint marks a depth-sorted (non-decor) object. */
  readonly walkBlockAreas?: readonly Readonly<LandscapeBlockArea>[];
  /** Repeated `LogicBuildBlockArea` lines - the object's build-exclusion ring (the collision mask reads it). */
  readonly buildBlockAreas?: readonly Readonly<LandscapeBlockArea>[];
}

/** One resolved gathering-pipeline stage (a landscape type + the `landscapeGfx` records that place it). */
export interface GatheringStageRow {
  readonly landscapeType: number;
  readonly gfxIndices: readonly number[];
}

/** One good's resolved gathering pipeline as it ships in `content/ir.json`'s `gatheringPipeline` - the
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

/** One `[landscapetype]` row as it ships in `content/ir.json`'s `landscape` - typeId + logic name. */
export interface LandscapeTypeRow {
  readonly typeId?: number;
  readonly name?: string;
}

/**
 * The app's view of the served `content/ir.json`. Every lane is optional, so an `ir.json` generated before a
 * lane existed still loads. The pipeline writes the file through the `@open-northland/data` zod schema, so
 * the fetched JSON is cast to this view at the I/O boundary rather than re-validated per boot.
 */
export interface ContentIr {
  readonly bobSequences?: readonly { imagelib: string; sequences?: BobSeqRow[] }[];
  readonly gfxAtomics?: readonly GfxAnimAtomicRow[];
  readonly gfxWalkAtomics?: readonly GfxWalkAtomicRow[];
  readonly goods?: readonly IrGoodRow[];
  readonly buildingBobs?: readonly BuildingBobRow[];
  readonly constructionLayers?: readonly ConstructionLayerRow[];
  readonly buildingOverlays?: readonly BuildingOverlayRow[];
  readonly buildingFlagPoints?: readonly BuildingFlagPointRow[];
  /** `gfxsoldierflagpoint` - the mast a manned post flies its garrison flag from. Same row shape as
   *  {@link buildingFlagPoints}; only the tower records carry one. */
  readonly buildingSoldierFlagPoints?: readonly BuildingFlagPointRow[];
  readonly gatheringPipeline?: readonly GatheringPipelineRow[];
  readonly landscapeGfx?: readonly LandscapeGfxRow[];
  /** The `[landscapetype]` logic table - the {@link LandscapeGfxRow.logicType} join key. */
  readonly landscape?: readonly LandscapeTypeRow[];
  /** The approximated per-typeId ground binding (`buildTerrainPatterns`) the terrain renderer reads. */
  readonly terrainPatterns?: readonly TerrainPattern[];
  /** The full 927-record `[GfxPattern]` table - the 1:1 per-triangle ground join for decoded maps. */
  readonly gfxPatterns?: readonly GfxPattern[];
  /** The `[transition]` ground-overlay table - a decoded map's `transitions.types` names join onto it. */
  readonly gfxPatternTransitions?: readonly GfxPatternTransition[];
  /** The per-logicType ground classes (`trianglepatterntypes.cif`) - the walk/build flags the map-collision
   *  join classes real ground by. */
  readonly trianglePatternTypes?: readonly TrianglePatternType[];
  /** Type-table views the authored-entity joins read, plus the extracted ground `footprint`: collision
   *  body, build-exclusion zone, and door. */
  readonly buildings?: readonly {
    typeId?: number;
    id?: string;
    kind?: string;
    footprint?: BuildingFootprint;
  }[];
  readonly jobs?: readonly { typeId?: number; id?: string; name?: string }[];
  /** `name` is a species join key too: a map's `setanimal` authors the display name (`evil hares`). */
  readonly tribes?: readonly { typeId?: number; id?: string; name?: string }[];
  /** The `animaltypes.ini` records, read for tribe membership (`tribeType`) and for whether the record is a
   *  living creature (`hitpointsAdult` > 0) or a decorative swarm the sim never spawns. Behaviour fields
   *  stay sim-side. */
  readonly animals?: readonly { tribeType?: number; hitpointsAdult?: number }[];
  /** The `armortypes.ini` records - the worn-good → recolor-tier join. */
  readonly armor?: readonly { typeId?: number; goodType?: number }[];
  /** The decoded sound bank (`@open-northland/audio` builds its index from it). */
  readonly sounds?: SoundBank;
}

/** The `[bobseq]` imagelib whose sequences drive the settler - the body bob set the head atlas shares ids with. */
export const BODY_IMAGELIB = 'cr_hum_body_00.bmd';
