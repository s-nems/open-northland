/**
 * Landscape logic types, triangle-pattern types, landscape graphics-frame records, and the goods↔landscape gathering-pipeline join.
 */
import {
  GatheringPipeline,
  GfxPattern,
  type GoodType,
  LandscapeGfx,
  LandscapeType,
  TrianglePatternType,
} from '@vinland/data';
import { decodeCifStringArray } from '../../cif.js';
import {
  cifLinesToSections,
  findProp,
  findProps,
  getInt,
  getIntTuple,
  getStr,
  normalizeOptionalPath,
  normalizePaletteName,
  type RuleSection,
  requireTypeId,
  type SourceRef,
  slug,
} from '../grammar.js';

/**
 * Extracts `[landscapetype]` sections into validated {@link LandscapeType} IR. Captures the inputs the
 * Phase-2 cell-adjacency graph needs: `maximumValency` (per-cell capacity → `maxValency`) and the
 * `allowedonland`/`allowedonwater`/`allowedoneverything` placement-layer flags (`1`/`0` ints). These
 * are the cell-graph's per-type valency + placement source, NOT a render-triangle property. There is
 * NO per-type movement-cost/weight field in this table — the engine gates movement by walkability +
 * valency, so the graph uses a uniform unit walk cost (see packages/sim/src/terrain.ts). `walkable`/
 * `buildable` keep their schema defaults — they're a later derivation (not cleanly from these flags,
 * which mark placement layer, not traversal). The raw `name` + the `transition` tuples are captured
 * verbatim (the tuple field-semantics are NOT decoded — see docs/SOURCES.md); `debugcolor`/
 * `playeridallowed` (editor concerns) are still skipped.
 */
export function extractLandscape(sections: readonly RuleSection[], src: SourceRef): LandscapeType[] {
  const landscape: LandscapeType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'landscapetype') continue;
    const typeId = requireTypeId(sec, 'landscapetype', src);
    const name = getStr(sec, 'name');
    // Raw `transition` tuples in file order, variable arity (mostly 5 ints, a few `mine` types 2),
    // captured VERBATIM — the encoding is not reversed, so no semantics are read into the positions.
    const transitions = findProps(sec, 'transition')
      .map((p) => p.values.map((v) => Number.parseInt(v, 10)))
      .filter((vals) => vals.length > 0 && vals.every((n) => !Number.isNaN(n)));
    landscape.push(
      LandscapeType.parse({
        typeId,
        id: name ? slug(name) : `landscape_${typeId}`,
        name,
        maxValency: getInt(sec, 'maximumValency') ?? 0,
        allowedOnLand: getInt(sec, 'allowedonland') === 1,
        allowedOnWater: getInt(sec, 'allowedonwater') === 1,
        allowedOnEverything: getInt(sec, 'allowedoneverything') === 1,
        transitions,
        source: { file: src.file, block: 'landscapetype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return landscape;
}

/**
 * Extracts `[trianglepatterntype]` sections from `Data/logic/trianglepatterntypes.cif` (`.cif`-only,
 * decoded via {@link decodeCifStringArray} → {@link cifLinesToSections}) into validated
 * {@link TrianglePatternType} IR — the **logic classification** of the terrain triangles
 * (water/land/mountain/sand/...), the cross-reference target of a {@link GfxPattern}'s `logicType`. The
 * real file is 10 records (type ids 1..10), despite the 82-string count its `.cif` header reports (10
 * section headers + 72 property lines). Throws on a section missing the required numeric `type` (matches
 * {@link extractGoods}'s throw-on-malformed stance — a triangle type with no id is corrupt source). The
 * `0`/`1` flags become booleans (`getInt(...) === 1`, as {@link extractLandscape}/{@link extractAnimals}
 * do); an absent flag is `false` (the source omits a `0`). `debugcolor` is the flat per-type RGB
 * fallback colour, kept for the cheap legible terrain render when textures are deferred.
 */
export function extractTrianglePatternTypes(
  sections: readonly RuleSection[],
  src: SourceRef,
): TrianglePatternType[] {
  const types: TrianglePatternType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'trianglepatterntype') continue;
    const type = requireTypeId(sec, 'trianglepatterntype', src);
    types.push(
      TrianglePatternType.parse({
        type,
        debugName: getStr(sec, 'debugname'),
        isWater: getInt(sec, 'iswater') === 1,
        humanCanWalkOn: getInt(sec, 'humancanwalkon') === 1,
        houseCanBeBuildOn: getInt(sec, 'housecanbebuildon') === 1,
        bioCanGrowOn: getInt(sec, 'biocangrowon') === 1,
        bioCanPlantOn: getInt(sec, 'biocanplanton') === 1,
        island: getInt(sec, 'island') === 1,
        moveResistance: getInt(sec, 'moveresistance') ?? 0,
        debugColor: getIntTuple(sec, 'debugcolor', 3),
        source: { file: src.file, block: 'trianglepatterntype', layer: src.layer ?? 'base' },
      }),
    );
  }
  return types;
}

/**
 * Extracts the FULL `[GfxLandscape]` table from `landscapes.cif` into validated {@link LandscapeGfx}
 * IR — every placeable landscape object (866 records: trees, stones, bushes, mine decals, waves, signs,
 * wonders), each joining its visual half (`GfxBobLibs` body+shadow, `GfxPalette`, per-state `GfxFrames`,
 * `GfxStatic`/`GfxLoopAnimation`) to its logic half (`LogicType` → the landscape type table,
 * `LogicMaximumValency`, `LogicIsWorkable`, the `LogicWalkBlockArea`/`LogicBuildBlockArea`/
 * `LogicWorkArea` footprints). This is the table a decoded map's object placements join onto **by
 * `EditName`** (the map's `eald` dictionary stores names) — distinct from
 * {@link extractLandscapeGraphics}, which only derives the `(bmd, palette)` atlas work list.
 *
 * Like {@link extractPatterns} this keeps **every** record in file order ({@link LandscapeGfx.index}
 * is the positional id, so skipping a malformed record would renumber the rest); visual fields are
 * read defensively (`undefined` on absence) rather than aborting the batch. Keys are the editor's
 * CamelCase except the lower-case `logicispileableonmap` (matched verbatim per the case-sensitive
 * parser — see AGENTS.md [0cbe894]); `GfxFrames`/block-area lines repeat per state/offset and
 * are kept in file order.
 */
export function extractLandscapeGfx(sections: readonly RuleSection[], src: SourceRef): LandscapeGfx[] {
  const records: LandscapeGfx[] = [];
  let index = 0;
  for (const sec of sections) {
    if (sec.name !== 'GfxLandscape') continue;
    const libs = findProp(sec, 'GfxBobLibs');
    const bmd = libs?.values[0];
    const shadow = libs?.values[1];
    const paletteName = getStr(sec, 'GfxPalette');
    const blockAreas = (key: string): number[][] =>
      findProps(sec, key)
        .map((p) => p.values.map((v) => Number.parseInt(v, 10)))
        .filter((vals) => vals.length === 4 && vals.every((n) => !Number.isNaN(n)));
    const frames = findProps(sec, 'GfxFrames')
      .map((p) => p.values.map((v) => Number.parseInt(v, 10)))
      .filter((vals) => vals.length >= 2 && vals.every((n) => !Number.isNaN(n)))
      .map((vals) => ({ state: vals[0] as number, bobIds: vals.slice(1) }));
    records.push(
      LandscapeGfx.parse({
        index: index++,
        editName: getStr(sec, 'EditName'),
        editGroups: [...(findProp(sec, 'EditGroups')?.values ?? [])],
        logicType: getInt(sec, 'LogicType') ?? 0,
        maxValency: getInt(sec, 'LogicMaximumValency'),
        isWorkable: getInt(sec, 'LogicIsWorkable') === 1,
        walkBlockAreas: blockAreas('LogicWalkBlockArea'),
        buildBlockAreas: blockAreas('LogicBuildBlockArea'),
        workAreas: blockAreas('LogicWorkArea'),
        bmd: normalizeOptionalPath(bmd),
        shadowBmd: normalizeOptionalPath(shadow),
        paletteName:
          paletteName !== undefined && paletteName.trim() !== ''
            ? normalizePaletteName(paletteName)
            : undefined,
        frames,
        isStatic: getInt(sec, 'GfxStatic') !== 0,
        loopAnimation: getInt(sec, 'GfxLoopAnimation') === 1,
        dynamicBackground: getInt(sec, 'GfxDynamicBackground') === 1,
        source: { file: src.file, block: 'GfxLandscape', layer: src.layer ?? 'base' },
      }),
    );
  }
  return records;
}

/**
 * Resolves the {@link GatheringPipeline} join for every map-gathered good: `goodType` → its three
 * `landscapeTo{Harvest,Pickup,Store}` stage ids → the {@link LandscapeGfx} records that place each
 * stage. The stage→gfx leg joins by `LandscapeGfx.logicType == the stage's landscape type` (the
 * `[GfxLandscape]` cross-ref to the `[landscapetype]` table — the houses analog is `[GfxHouse]
 * LogicType`). Materialized once here so a later gathering system reads the stages + their placeable
 * gfx directly instead of re-scanning the 866-record gfx table each time.
 *
 * One record per good carrying a `gathering` chain (the ~11 raw goods); produced/in-house goods are
 * skipped. A lane the good omits (honey has no `harvest`) is left absent. A stage whose landscape
 * type has no placeable gfx record yields an EMPTY `gfxIndices` — faithful data (some store lanes are
 * pure-logic "dropped good" markers), surfaced at build time rather than silently dropped.
 */
export function buildGatheringPipeline(
  goods: readonly GoodType[],
  landscapeGfx: readonly LandscapeGfx[],
): GatheringPipeline[] {
  // logicType -> the gfx records (by positional index, ascending) that place it, built once.
  const gfxByLogicType = new Map<number, number[]>();
  for (const g of landscapeGfx) {
    const list = gfxByLogicType.get(g.logicType);
    if (list) list.push(g.index);
    else gfxByLogicType.set(g.logicType, [g.index]);
  }
  const stage = (
    landscapeType: number | undefined,
  ): { landscapeType: number; gfxIndices: number[] } | undefined =>
    landscapeType === undefined
      ? undefined
      : { landscapeType, gfxIndices: gfxByLogicType.get(landscapeType) ?? [] };
  const pipeline: GatheringPipeline[] = [];
  for (const good of goods) {
    if (good.gathering === undefined) continue;
    const harvest = stage(good.gathering.harvest);
    const pickup = stage(good.gathering.pickup);
    const store = stage(good.gathering.store);
    pipeline.push(
      GatheringPipeline.parse({
        goodType: good.typeId,
        goodId: good.id,
        harvestAtomic: good.atomics.harvest,
        bioLandscape: good.gathering.bioLandscape,
        ...(harvest ? { harvest } : {}),
        ...(pickup ? { pickup } : {}),
        ...(store ? { store } : {}),
      }),
    );
  }
  return pipeline;
}
