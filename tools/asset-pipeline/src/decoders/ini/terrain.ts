/**
 * Terrain GFX patterns and transitions.
 */
import { GfxPattern, GfxPatternTransition, type TrianglePatternType } from '@open-northland/data';
import {
  findProp,
  getInt,
  getIntRows,
  getIntTuple,
  getStr,
  makeSource,
  normalizeAssetPath,
  type RuleSection,
  type SourceRef,
} from './grammar.js';

/**
 * Extracts the `.cif`-only `[GfxPattern]` sections of `Data/engine2d/inis/patterns/pattern.cif` into
 * validated {@link GfxPattern} IR, the texture-to-cell binding for the triangle-mesh terrain: a
 * `text_NNN.pcx` ground texture, the two triangles' 6-int UV tuples (`GfxCoordsA`/`GfxCoordsB`) and a
 * `LogicType` ({@link TrianglePatternType.type} cross-ref, `0` = the misc/border tiles that classify to
 * no logic type). `EditGroups` keeps its raw quoted group strings verbatim.
 *
 * The record has no explicit id, so {@link GfxPattern.id} is its 0-based position among matched sections
 * and a map references a pattern by that index. No record may therefore be dropped or reordered: a
 * wrong-arity coord set degrades to `undefined` and the degenerate record still occupies its slot.
 */
export function extractPatterns(sections: readonly RuleSection[], src: SourceRef): GfxPattern[] {
  const patterns: GfxPattern[] = [];
  let id = 0;
  for (const sec of sections) {
    if (sec.name !== 'GfxPattern') continue;
    const texture = getStr(sec, 'GfxTexture');
    patterns.push(
      GfxPattern.parse({
        id: id++,
        editName: getStr(sec, 'EditName'),
        editGroups: [...(findProp(sec, 'EditGroups')?.values ?? [])],
        logicType: getInt(sec, 'LogicType') ?? 0,
        texture: texture !== undefined ? normalizeAssetPath(texture) : undefined,
        coordsA: getIntTuple(sec, 'GfxCoordsA', 6),
        coordsB: getIntTuple(sec, 'GfxCoordsB', 6),
        source: makeSource(src, 'GfxPattern'),
      }),
    );
  }
  return patterns;
}

/**
 * Extracts the `[transition]` ground-overlay records from `transitions.cif` into validated
 * {@link GfxPatternTransition} IR: an RGB texture plus a separate alpha-mask picture, and six repeated
 * `GfxCoordsA`/`GfxCoordsB` triangle-UV lines kept in file order because a map lane's `value % 6`
 * selects the pair positionally. The sibling `[pointtype]` editor sections are not extracted, and like
 * {@link extractPatterns} every record keeps its positional index.
 */
export function extractPatternTransitions(
  sections: readonly RuleSection[],
  src: SourceRef,
): GfxPatternTransition[] {
  const records: GfxPatternTransition[] = [];
  let index = 0;
  const sixInts = (n: number): boolean => n === 6;
  for (const sec of sections) {
    if (sec.name !== 'transition') continue;
    const texture = getStr(sec, 'GfxTexture');
    const textureAlpha = getStr(sec, 'GfxTextureAlpha');
    records.push(
      GfxPatternTransition.parse({
        index: index++,
        editName: getStr(sec, 'name'),
        pointType: getStr(sec, 'pointtype'),
        texture: texture !== undefined ? normalizeAssetPath(texture) : undefined,
        textureAlpha: textureAlpha !== undefined ? normalizeAssetPath(textureAlpha) : undefined,
        coordsA: getIntRows(sec, 'GfxCoordsA', sixInts),
        coordsB: getIntRows(sec, 'GfxCoordsB', sixInts),
        source: makeSource(src, 'transition'),
      }),
    );
  }
  return records;
}
