import { LandscapeGfx, LandscapeType, TrianglePatternType } from '@open-northland/data';
import type { RuleSection } from '../grammar.js';
import {
  getPaletteName,
  makeSource,
  normalizeOptionalPath,
  requireTypeId,
  type SourceRef,
  slug,
} from '../ir-fields.js';
import { findProp, getInt, getIntRows, getIntTuple, getStr } from '../props.js';

/**
 * The `allowedon*` flags mark the placement layer, not traversal, so `walkable`/`buildable` keep
 * their schema defaults rather than deriving from them.
 */
export function extractLandscape(sections: readonly RuleSection[], src: SourceRef): LandscapeType[] {
  const landscape: LandscapeType[] = [];
  for (const sec of sections) {
    if (sec.name !== 'landscapetype') continue;
    const typeId = requireTypeId(sec, 'landscapetype', src);
    const name = getStr(sec, 'name');
    // Variable arity: mostly 5 ints, a few `mine` types 2, so any non-empty row is kept verbatim.
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
 * The real `trianglepatterntypes.cif` holds 10 records, though its header counts 82 strings: 10
 * section headers plus 72 property lines.
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
 * Every record keeps its slot: {@link LandscapeGfx.index} is positional, so a malformed one is read
 * defensively rather than skipped, which would renumber the rest.
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
        userFxMatrix: getInt(sec, 'GfxUserFXMatrix') === 1,
        source: makeSource(src, 'GfxLandscape'),
      }),
    );
  }
  return records;
}
