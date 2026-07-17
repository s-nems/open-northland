import type { GfxPattern, LandscapeType, TrianglePatternType } from '@open-northland/data';
import { TerrainPattern } from '@open-northland/data';
import { makeSource, type SourceRef } from '../../decoders/ini.js';

/** The three coarse ground families a landscape typeId is approximated into, each pinned to a logic type + a representative pattern's preferred editName prefix. */
const TERRAIN_FAMILIES = [
  { family: 'water', logicType: 1, prefix: 'water' },
  { family: 'mountain', logicType: 3, prefix: 'mountain' },
  { family: 'land', logicType: 2, prefix: 'meadow' },
] as const;

type TerrainFamily = (typeof TERRAIN_FAMILIES)[number]['family'];

/**
 * Classifies a {@link LandscapeType} (by its `id` slug) into a coarse ground family. The map's per-cell
 * `lmlt` value is a landscape typeId, but those types are mostly objects (void/tree/rock/iron/wheat/…),
 * not ground classes — so the ground under a cell is approximated from the type's name: a `water` name →
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
 * if none match the seed, any pattern of that `logicType`. Among candidates, the shortest editName,
 * lowest id wins (the unsuffixed base tile like `"water 01"` over a `"block water 00 00 00"` transition
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
 * Builds the approximated typeId→ground-pattern table the terrain renderer consumes
 * ({@link TerrainPattern} IR): for each {@link LandscapeType}, classify its ground family
 * ({@link classifyTerrainFamily}) and bind it to that family's one representative
 * {@link GfxPattern} ({@link pickRepresentativePattern}) — its `text_NNN` texture + the two triangles'
 * UVs — plus the family logic type's `debugColor` (the flat-tint fallback). A recorded deviation, not a
 * 1:1 match (source basis): the original computes the per-cell pattern from corner types + variant
 * lanes, an oracle-blocked algorithm; here every typeId of a family gets the same representative
 * ground. A landscape typeId whose family has no usable pattern is skipped (binds no ground → the
 * renderer keeps its flat-colour fallback for those cells).
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
