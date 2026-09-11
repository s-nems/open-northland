import type { TerrainMapFile } from '@open-northland/data';
import type { GroundPattern, SceneTerrain } from '@open-northland/render';

export { ownGrassBindings } from '../../content/own-assets/grass-bindings.js';

export interface PatchArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function ownMapPatch(
  map: TerrainMapFile,
  area: PatchArea,
  patterns: ReadonlyMap<string, GroundPattern>,
): { terrain: SceneTerrain; names: readonly string[] } {
  const { x, y, width, height } = area;
  if (
    ![x, y, width, height].every(Number.isInteger) ||
    x < 0 ||
    y < 0 ||
    width < 2 ||
    height < 2 ||
    x + width > map.width ||
    y + height > map.height ||
    y % 2 !== 0
  )
    throw new Error('Invalid patch bounds; the starting row must be even to preserve the staggered lattice.');
  if (!map.ground) throw new Error('Map has no ground pattern lanes.');
  const cells = Array.from(
    { length: width * height },
    (_, index) => (y + Math.floor(index / width)) * map.width + x + (index % width),
  );
  const slice = (lane: readonly number[]): number[] =>
    cells.map((cell) => {
      const value = lane[cell];
      if (value === undefined) throw new Error('Map lane is incomplete.');
      return value;
    });
  const ground = { patterns: map.ground.patterns, a: slice(map.ground.a), b: slice(map.ground.b) };
  const names = [
    ...new Set([...ground.a, ...ground.b].map((id) => ground.patterns[id] ?? '<missing>')),
  ].sort();
  const missing = names.filter((name) => !patterns.has(name));
  if (missing.length) throw new Error(`Unsupported ground patterns: ${missing.join(', ')}`);
  const transitions = map.transitions
    ? {
        types: map.transitions.types,
        a1: slice(map.transitions.a1),
        b1: slice(map.transitions.b1),
        a2: slice(map.transitions.a2),
        b2: slice(map.transitions.b2),
      }
    : undefined;
  if (
    transitions &&
    [transitions.a1, transitions.b1, transitions.a2, transitions.b2].some((lane) =>
      lane.some((v) => v !== 255),
    )
  )
    throw new Error(
      'This patch uses transition overlays; the own-map grass binding does not cover them yet.',
    );
  return {
    names,
    terrain: {
      width,
      height,
      typeIds: slice(map.typeIds),
      ground,
      ...(transitions ? { transitions } : {}),
      ...(map.elevation ? { elevation: slice(map.elevation) } : {}),
      ...(map.brightness ? { brightness: slice(map.brightness) } : {}),
    },
  };
}
