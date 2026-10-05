import type { ContentSet } from '@open-northland/data';
import type { World } from '../../ecs/world.js';
import { type ReachArea, searchReach } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { walkBlockMask } from '../footprint/walk-block-mask.js';
import { roadAreaKey, syncRoadLane } from '../roads/index.js';

export function signpostTerrainKey(world: World, content: ContentSet, terrain: TerrainGraph): string {
  syncRoadLane(world, terrain);
  return `${walkBlockMask(world, { content }, terrain).version}:${terrain.mirroredRoadRevision}`;
}

export interface TerrainReach {
  readonly terrain: TerrainGraph;
  readonly hx: number;
  readonly hy: number;
  readonly range: number;
  version: string;
  readonly localKey: string;
  readonly area: ReachArea;
}

/** The flood may detour outside the geometric result: at resistance one it visits up to twice the range. */
export function terrainReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
  range: number,
  held?: TerrainReach,
): TerrainReach {
  const version = signpostTerrainKey(world, content, terrain);
  const sameOrigin = held?.terrain === terrain && held.hx === hx && held.hy === hy && held.range === range;
  if (sameOrigin && held.version === version) return held;
  const area = { minHx: hx - 2 * range, maxHx: hx + 2 * range, minHy: hy - 2 * range, maxHy: hy + 2 * range };
  const mask = walkBlockMask(world, { content }, terrain);
  const localKey = `${mask.areaVersion(area)}:${roadAreaKey(world, area)}`;
  if (sameOrigin && held.localKey === localKey) {
    held.version = version;
    return held;
  }
  return {
    terrain,
    hx,
    hy,
    range,
    version,
    localKey,
    area: searchReach(terrain, mask.levelled(), hx, hy, range),
  };
}
