/**
 * Landscape logic types, triangle-pattern types, and landscape graphics-frame records.
 */
import { GfxPattern, LandscapeGfx, LandscapeType, TrianglePatternType } from '@open-northland/data';
import { decodeCifStringArray } from '../../cif.js';
import {
  cifLinesToSections,
  findProp,
  getInt,
  getIntRows,
  getIntTuple,
  getPaletteName,
  getStr,
  makeSource,
  normalizeOptionalPath,
  type RuleSection,
  requireTypeId,
  type SourceRef,
  slug,
} from '../grammar.js';

/**
 * Extracts `[landscapetype]` sections into validated {@link LandscapeType} IR. Captures the inputs the
 * cell-adjacency graph needs: `maximumValency` (per-cell capacity → `maxValency`) and the
 * `allowedonland`/`allowedonwater`/`allowedoneverything` placement-layer flags (`1`/`0` ints). These
 * are the cell-graph's per-type valency + placement source, not a render-triangle property. There is
 * no per-type movement-cost/weight field in this table — the engine gates movement by walkability +
 * valency, so the graph uses a uniform unit walk cost (see packages/sim/src/terrain.ts). `walkable`/
 * `buildable` keep their schema defaults — they're a later derivation (not cleanly from these flags,
 * which mark placement layer, not traversal). The raw `name` + the `transition` tuples are captured
 * verbatim (the tuple field-semantics are not decoded — see docs/SOURCES.md); `debugcolor`/
 * `playeridallowed` (editor concerns) are still skipped.
 */
export function extractLandscape(sections: readonly RuleSection[], src: SourceRef): LandscapeType[] {
  const landscape: LandscapeType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'landscapetype') continue;
    const typeId = requireTypeId(sec, 'landscapetype', src);
    const name = getStr(sec, 'name');
    // Raw `transition` tuples in file order, variable arity (mostly 5 ints, a few `mine` types 2),
    // captured verbatim — the encoding is not reversed, so no semantics are read into the positions.
    const transitions = getIntRows(sec, 'transition', (n) => n > 0);
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
        source: makeSource(src, 'landscapetype'),
      }),
    );
  }
  return landscape;
}

/**
 * Extracts `[trianglepatterntype]` sections from `Data/logic/trianglepatterntypes.cif` (`.cif`-only,
 * decoded via {@link decodeCifStringArray} → {@link cifLinesToSections}) into validated
 * {@link TrianglePatternType} IR — the logic classification of the terrain triangles
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
        source: makeSource(src, 'trianglepatterntype'),
      }),
    );
  }
  return types;
}

/**
 * Extracts the full `[GfxLandscape]` table from `landscapes.cif` into validated {@link LandscapeGfx}
 * IR — every placeable landscape object (866 records: trees, stones, bushes, mine decals, waves, signs,
 * wonders), each joining its visual half (`GfxBobLibs` body+shadow, `GfxPalette`, per-state `GfxFrames`,
 * `GfxStatic`/`GfxLoopAnimation`) to its logic half (`LogicType` → the landscape type table,
 * `LogicMaximumValency`, `LogicIsWorkable`, the `LogicWalkBlockArea`/`LogicBuildBlockArea`/
 * `LogicWorkArea` footprints). This is the table a decoded map's object placements join onto by
 * `EditName` (the map's `eald` dictionary stores names) — distinct from
 * {@link extractLandscapeGraphics}, which only derives the `(bmd, palette)` atlas work list.
 *
 * Like {@link extractPatterns} this keeps every record in file order ({@link LandscapeGfx.index}
 * is the positional id, so skipping a malformed record would renumber the rest); visual fields are
 * read defensively (`undefined` on absence) rather than aborting the batch. Keys are the editor's
 * CamelCase except the lower-case `logicispileableonmap` (matched verbatim per the case-sensitive
 * parser — see AGENTS.md); `GfxFrames`/block-area lines repeat per state/offset and are kept in file
 * order.
 */
export function extractLandscapeGfx(sections: readonly RuleSection[], src: SourceRef): LandscapeGfx[] {
  const records: LandscapeGfx[] = [];
  let index = 0;
  for (const sec of sections) {
    if (sec.name !== 'GfxLandscape') continue;
    const libs = findProp(sec, 'GfxBobLibs');
    const bmd = libs?.values[0];
    const shadow = libs?.values[1];
    const blockAreas = (key: string): number[][] => getIntRows(sec, key, (n) => n === 4);
    const frames = getIntRows(sec, 'GfxFrames', (n) => n >= 2).map((vals) => ({
      state: vals[0] as number,
      bobIds: vals.slice(1),
    }));
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
        paletteName: getPaletteName(sec, 'GfxPalette'),
        frames,
        isStatic: getInt(sec, 'GfxStatic') !== 0,
        loopAnimation: getInt(sec, 'GfxLoopAnimation') === 1,
        dynamicBackground: getInt(sec, 'GfxDynamicBackground') === 1,
        source: makeSource(src, 'GfxLandscape'),
      }),
    );
  }
  return records;
}
