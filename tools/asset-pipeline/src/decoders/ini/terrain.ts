/**
 * Terrain GFX patterns and transitions, plus the approximated terrain-pattern builder that maps landscape ids onto ground families.
 */
import {
  GfxPattern,
  GfxPatternTransition,
  type LandscapeType,
  TerrainPattern,
  type TrianglePatternType,
} from '@open-northland/data';
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
 * {@link GfxPattern} IR — the **texture→cell binding** for the triangle-mesh terrain (927 records). Each
 * pattern names a `text_NNN.pcx` ground texture, the two triangles' 6-int UV tuples (`GfxCoordsA`/
 * `GfxCoordsB`) and a `LogicType` ({@link TrianglePatternType.type} cross-ref; `0` = the misc/border
 * tiles that classify to no logic type).
 *
 * Unlike the throw/skip extractors, this **keeps every record and never drops or reorders one**: the
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
 * texture + separate alpha-mask picture and SIX repeated `GfxCoordsA`/`GfxCoordsB` triangle-UV
 * lines — kept in FILE ORDER because a map lane's `value % 6` selects the pair positionally.
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

/** The three coarse ground families a landscape typeId is approximated into, each pinned to a logic type + a representative pattern's preferred editName prefix. */
const TERRAIN_FAMILIES = [
  { family: 'water', logicType: 1, prefix: 'water' },
  { family: 'mountain', logicType: 3, prefix: 'mountain' },
  { family: 'land', logicType: 2, prefix: 'meadow' },
] as const;

type TerrainFamily = (typeof TERRAIN_FAMILIES)[number]['family'];

/**
 * Classifies a {@link LandscapeType} (by its `id` slug) into a coarse ground family. The map's per-cell
 * `lmlt` value is a landscape typeId, but those types are mostly OBJECTS (void/tree/rock/iron/wheat/…),
 * not ground classes — so the GROUND under a cell is approximated from the type's NAME: a `water` name →
 * water, a `rock`/`stone` name → mountain, everything else (incl. tree/bush/wood, whose ground is land)
 * → land. This is the deviation the 1:1-oracle-blocked terrain render ships (source basis).
 */
function classifyTerrainFamily(landscapeId: string): TerrainFamily {
  const n = landscapeId.toLowerCase();
  if (n.includes('water')) return 'water';
  if (n.includes('rock') || n.includes('stone')) return 'mountain';
  return 'land';
}

/**
 * Picks the representative {@link GfxPattern} for a family: the pattern of the family's `logicType` whose
 * `editName` starts with the family seed (`water`/`meadow`/`mountain`) — the clean full-tile base — else,
 * if none match the seed, any pattern of that `logicType`. Among candidates, the **shortest editName,
 * lowest id** wins (the unsuffixed base tile like `"water 01"` over a `"block water 00 00 00"` transition
 * variant), a deterministic pick. Returns `undefined` if the family's `logicType` has no usable pattern
 * (no texture / coords) — then that family's typeIds bind nothing.
 */
function pickRepresentativePattern(
  patterns: readonly GfxPattern[],
  logicType: number,
  prefix: string,
): GfxPattern | undefined {
  const usable = patterns.filter(
    (p) =>
      p.logicType === logicType &&
      p.texture !== undefined &&
      p.coordsA !== undefined &&
      p.coordsB !== undefined,
  );
  const seeded = usable.filter((p) => (p.editName ?? '').toLowerCase().startsWith(prefix));
  const pool = seeded.length > 0 ? seeded : usable;
  return [...pool].sort((a, b) => (a.editName ?? '').length - (b.editName ?? '').length || a.id - b.id)[0];
}

/**
 * Builds the **approximated** typeId→ground-pattern table the terrain renderer consumes
 * ({@link TerrainPattern} IR, historical plan phase 2 step 2): for each {@link LandscapeType}, classify its
 * ground family ({@link classifyTerrainFamily}) and bind it to that family's one representative
 * {@link GfxPattern} ({@link pickRepresentativePattern}) — its `text_NNN` texture + the two triangles'
 * UVs — plus the family logic type's `debugColor` (the flat-tint fallback). A cross-table builder (like
 * {@link fillBuildingRecipes}), so it runs after the three source tables are extracted. **This is a
 * recorded deviation, not a 1:1 match** (source basis): the original computes the per-cell pattern
 * from corner types + variant lanes, an oracle-blocked algorithm; here every typeId of a family gets the
 * SAME representative ground. A landscape typeId whose family has no usable pattern is skipped (binds no
 * ground → the renderer keeps its flat-colour fallback for those cells).
 */
export function buildTerrainPatterns(
  landscape: readonly LandscapeType[],
  patterns: readonly GfxPattern[],
  triangleTypes: readonly TrianglePatternType[],
  src: SourceRef,
): TerrainPattern[] {
  const debugByType = new Map(triangleTypes.map((t) => [t.type, t.debugColor]));
  const repByFamily = new Map<TerrainFamily, GfxPattern | undefined>(
    TERRAIN_FAMILIES.map((f) => [f.family, pickRepresentativePattern(patterns, f.logicType, f.prefix)]),
  );
  const out: TerrainPattern[] = [];
  for (const lt of landscape) {
    const family = classifyTerrainFamily(lt.id);
    const rep = repByFamily.get(family);
    if (rep?.texture === undefined || rep.coordsA === undefined || rep.coordsB === undefined) continue;
    out.push(
      TerrainPattern.parse({
        typeId: lt.typeId,
        family,
        patternId: rep.id,
        logicType: rep.logicType,
        texture: rep.texture,
        coordsA: rep.coordsA,
        coordsB: rep.coordsB,
        debugColor: debugByType.get(rep.logicType),
        source: makeSource(src, 'terrainpattern'),
      }),
    );
  }
  return out;
}
