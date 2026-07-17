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
 * Extracts `[GfxPattern]` sections from `Data/engine2d/inis/patterns/pattern.cif` (`.cif`-only, with
 * CamelCase keys + a CamelCase section header like {@link extractLandscapeGraphics}) into validated
 * {@link GfxPattern} IR — the texture→cell binding for the triangle-mesh terrain (927 records). Each
 * pattern names a `text_NNN.pcx` ground texture, the two triangles' 6-int UV tuples (`GfxCoordsA`/
 * `GfxCoordsB`) and a `LogicType` ({@link TrianglePatternType.type} cross-ref; `0` = the misc/border
 * tiles that classify to no logic type).
 *
 * Unlike the throw/skip extractors, this keeps every record and never drops or reorders one: the
 * record has no explicit id, so {@link GfxPattern.id} is its 0-based position and a map references a
 * pattern by that index — skipping a malformed record would renumber the rest. The visual fields are
 * therefore read defensively (a wrong-arity coord set → `undefined` via {@link getIntTuple}) rather than
 * aborting the offline batch, so even a degenerate record still occupies its positional slot. The `id`
 * counter advances only on a matched section, so it stays the pattern index even if other section kinds
 * were interleaved. `EditGroups` keeps its raw quoted group strings verbatim (editor metadata, unslugged).
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
 * {@link GfxPatternTransition} IR (38 records in the real data). Each record carries its RGB
 * texture + separate alpha-mask picture and six repeated `GfxCoordsA`/`GfxCoordsB` triangle-UV
 * lines — kept in file order because a map lane's `value % 6` selects the pair positionally.
 * The sibling `[pointtype]` sections (editor grouping metadata) are not extracted. Like
 * {@link extractPatterns}, every matched record keeps its positional {@link GfxPatternTransition.index}
 * and reads visual fields defensively (a wrong-arity coord line is dropped, not fatal).
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
