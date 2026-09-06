import type {
  BuildingFootprint,
  GfxInHouseProgram,
  GfxPattern,
  GfxPatternTransition,
  LandscapeBlockArea,
  SoundBank,
  TerrainPattern,
  TrianglePatternType,
} from '@open-northland/data';

/** One decoded `[bobseq]` sequence: a named frame range in its imagelib's bob pool. */
export interface BobSeqRow {
  readonly name: string;
  readonly start: number;
  readonly length: number;
}

/** One `[gfxanimatomic]` row - an atomic action's directional body animation: `(tribe, job, action)` →
 *  the `bodySeq` bobseq plus the per-facing frame lists a bare bobseq range cannot encode. */
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
  /** `logicinhouseatomicsubid` - the sub-clip slot an in-house program plays this record from. */
  readonly subId?: number;
}

/** One `[gfxwalkatomic]` row - the loaded-gait table: `(tribe, job, goodType)` → the `bodySeq` bobseq a
 *  hauler plays carrying that good. */
export interface GfxWalkAtomicRow {
  readonly tribe: number;
  readonly job: number;
  readonly goodType: number;
  readonly bodySeq: string;
  readonly headSeq?: string;
  /** Per-facing `gfxwalkframelist` lists of local frame indices into the `bodySeq` pool. */
  readonly dirFrames?: readonly (readonly number[])[];
  /** `logicwalkspeed` - the gait's authored speed rating. */
  readonly walkSpeed?: number;
}

/** One `[jobbasegraphics]` row - the bob sets a `(tribe, job)` human draws. */
export interface JobGraphicsRow {
  readonly tribe: number;
  readonly job: number;
  readonly body: string;
  readonly shadowBody?: string;
  readonly heads: readonly string[];
  readonly bodyPalette?: string;
  readonly headPalette?: string;
}

/** One good, narrowed to the typeId→slug join the graphics lanes need. */
export interface IrGoodRow {
  readonly typeId: number;
  readonly id: string;
}

/** One `[GfxHouse]` `LogicType`→`GfxBobId` row. */
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

/** One `[GfxHouse]` `GfxBobConstructionLayer` row. */
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

/** One `[GfxHouse]` type-4 `GfxOverlay` row - a finished building's animated state overlay (the mill
 *  rotor, the mason hut's work): `state` 0 = the idle still frame, `state` 1 = the working frames. */
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

/** One `[GfxHouse]` `GfxFlagPoint` row - where the original plants the building's sign chain.
 *  Approximation: `x`/`y` read as screen px from the building bob's draw anchor, +y down. */
export interface BuildingFlagPointRow {
  readonly tribeId: number;
  readonly typeId: number;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly editName?: string;
}

/** One `[GfxLandscape]` state's frame list. */
export interface LandscapeGfxFramesRow {
  readonly state: number;
  readonly bobIds: readonly number[];
}

/** One `[GfxLandscape]` record - a placed decor/resource object's atlas binding, joined to a
 *  `[landscapetype]` by `logicType` and to a map placement by `editName`. */
export interface LandscapeGfxRow {
  readonly index: number;
  readonly editName?: string;
  /** `EditGroups` - the editor palette folders the record sits in. */
  readonly editGroups?: readonly string[];
  readonly logicType: number;
  /** `LogicMaximumValency` - the record's harvest capacity in units, which sizes a spawned mineral
   *  deposit. Not the authored `frames` count. */
  readonly maxValency?: number;
  readonly bmd?: string;
  readonly shadowBmd?: string;
  readonly paletteName?: string;
  readonly frames?: readonly LandscapeGfxFramesRow[];
  /** `GfxStatic` - a still object (no per-frame playback). */
  readonly isStatic?: boolean;
  /** `GfxLoopAnimation` - the state's frame list loops continuously (waves, fire, smoke). */
  readonly loopAnimation?: boolean;
  /** Repeated `LogicWalkBlockArea` lines - a non-empty footprint marks a depth-sorted (non-decor) object. */
  readonly walkBlockAreas?: readonly Readonly<LandscapeBlockArea>[];
  /** Repeated `LogicBuildBlockArea` lines - the object's build-exclusion ring. */
  readonly buildBlockAreas?: readonly Readonly<LandscapeBlockArea>[];
}

/** One resolved gathering-pipeline stage (a landscape type + the `landscapeGfx` records that place it). */
export interface GatheringStageRow {
  readonly landscapeType: number;
  readonly gfxIndices: readonly number[];
}

/** One good's resolved good→landscape→gfx join (`buildGatheringPipeline`), keyed by `goodId`. */
export interface GatheringPipelineRow {
  readonly goodType: number;
  readonly goodId: string;
  readonly harvestAtomic?: number;
  readonly bioLandscape?: boolean;
  readonly harvest?: GatheringStageRow;
  readonly pickup?: GatheringStageRow;
  readonly store?: GatheringStageRow;
}

/** One `[landscapetype]` row, narrowed to its typeId and logic name. */
export interface LandscapeTypeRow {
  readonly typeId?: number;
  /** The `landscapetypes.ini` slug, the join key a rule names a landscape by. */
  readonly id?: string;
  readonly name?: string;
}

/**
 * The app's view of the served `content/ir.json`: the fetched JSON cast at the I/O boundary rather than
 * re-validated per boot, so every lane is typed optional. The pipeline writes the file through the
 * `@open-northland/data` zod schema.
 */
export interface ContentIr {
  readonly bobSequences?: readonly { imagelib: string; sequences?: BobSeqRow[] }[];
  readonly gfxAtomics?: readonly GfxAnimAtomicRow[];
  readonly gfxWalkAtomics?: readonly GfxWalkAtomicRow[];
  /** The `gfxanimmode 2` indoor choreography rows, one per `(tribe, job, action)`. */
  readonly gfxInHousePrograms?: readonly GfxInHouseProgram[];
  readonly goods?: readonly IrGoodRow[];
  readonly buildingBobs?: readonly BuildingBobRow[];
  readonly constructionLayers?: readonly ConstructionLayerRow[];
  readonly buildingOverlays?: readonly BuildingOverlayRow[];
  readonly buildingFlagPoints?: readonly BuildingFlagPointRow[];
  /** `gfxsoldierflagpoint` - the mast a manned post flies its garrison flag from; observed only on the
   *  tower records. */
  readonly buildingSoldierFlagPoints?: readonly BuildingFlagPointRow[];
  readonly gatheringPipeline?: readonly GatheringPipelineRow[];
  readonly landscapeGfx?: readonly LandscapeGfxRow[];
  /** The `[landscapetype]` logic table - `LandscapeGfxRow.logicType` joins onto it. */
  readonly landscape?: readonly LandscapeTypeRow[];
  /** The approximated per-typeId ground binding (`buildTerrainPatterns`). */
  readonly terrainPatterns?: readonly TerrainPattern[];
  /** The full `[GfxPattern]` table (927 records in the shipped content) - the 1:1 per-triangle ground
   *  join for decoded maps. */
  readonly gfxPatterns?: readonly GfxPattern[];
  /** The `[transition]` ground-overlay table - a decoded map's `transitions.types` names join onto it. */
  readonly gfxPatternTransitions?: readonly GfxPatternTransition[];
  /** The per-logicType ground classes (`trianglepatterntypes.cif`) - the walk/build flags the map-collision
   *  join classes real ground by. */
  readonly trianglePatternTypes?: readonly TrianglePatternType[];
  /** The building type rows, with the extracted ground `footprint`: collision body, build-exclusion zone,
   *  and door. */
  readonly buildings?: readonly {
    typeId?: number;
    id?: string;
    kind?: string;
    footprint?: BuildingFootprint;
  }[];
  readonly jobs?: readonly { typeId?: number; id?: string; name?: string }[];
  /** The `vehicletype` rows, narrowed to the join keys a mission script names a vehicle by. */
  readonly vehicles?: readonly { typeId?: number; id?: string; name?: string }[];
  /** `name` is a species join key too: a map's `setanimal` authors the display name (`evil hares`). */
  readonly tribes?: readonly { typeId?: number; id?: string; name?: string }[];
  /** The `[jobbasegraphics]` join: which bob sets each `(tribe, job)` human composes. */
  readonly jobGraphics?: readonly JobGraphicsRow[];
  /** The `animaltypes.ini` records, narrowed to tribe membership and to whether the record is a living
   *  creature (`hitpointsAdult` > 0) or a decorative swarm the sim never spawns; behaviour fields stay
   *  sim-side. */
  readonly animals?: readonly { tribeType?: number; hitpointsAdult?: number }[];
  /** The `armortypes.ini` records - the worn-good → recolor-tier join. */
  readonly armor?: readonly { typeId?: number; goodType?: number }[];
  readonly sounds?: SoundBank;
}

/** The `[bobseq]` imagelib whose sequences drive the settler - the body bob set the head atlas shares ids with. */
export const BODY_IMAGELIB = 'cr_hum_body_00.bmd';
