import type { GfxPattern, LandscapeType, TrianglePatternType } from '@open-northland/data';
import { TerrainPattern } from '@open-northland/data';
import { makeSource, type SourceRef } from '../../decoders/ini.js';

/** The ground families a landscape typeId is approximated into, each pinned to a `trianglepatterntypes`
 *  logic type and the `editName` prefix its representative pattern is seeded from. */
const TERRAIN_FAMILIES = [
  { family: 'water', logicType: 1, prefix: 'water' },
  { family: 'mountain', logicType: 3, prefix: 'mountain' },
  { family: 'land', logicType: 2, prefix: 'meadow' },
] as const;

type TerrainFamily = (typeof TERRAIN_FAMILIES)[number]['family'];

/**
 * Approximates the ground family from a landscape type's `id` slug: the per-cell `lmlt` value names an
 * object type (tree, rock, wheat), not a ground class, so the name is the only available signal.
 */
function classifyTerrainFamily(landscapeId: string): TerrainFamily {
  const n = landscapeId.toLowerCase();
  if (n.includes('water')) return 'water';
  if (n.includes('rock') || n.includes('stone')) return 'mountain';
  return 'land';
}

/**
 * Picks a family's representative pattern: among the usable patterns of its `logicType`, prefer an
 * `editName` starting with the family prefix, then the shortest name and lowest id. That ordering
 * selects the plain base tile (`water 01`) over a transition variant (`block water 00 00 00`).
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
 * Binds every landscape typeId to its family's one representative ground pattern and the logic type's
 * `debugColor`. An approximation: the original derives each cell's pattern from its corner types and
 * variant lanes. A typeId whose family has no usable pattern is skipped and binds no ground.
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
