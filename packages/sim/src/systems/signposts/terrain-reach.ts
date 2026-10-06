import type { ContentSet } from '@open-northland/data';
import type { Entity, World } from '../../ecs/world.js';
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

/** Each signpost's reach per range, shared by the link pass and the goods search, which flood from the
 *  same post node at the same range. */
const postReaches = new WeakMap<World, Map<number, Map<Entity, TerrainReach>>>();

/** {@link terrainReach} from signpost `post` standing on `(hx, hy)`, kept per post until it falls. */
export function postTerrainReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  post: Entity,
  hx: number,
  hy: number,
  range: number,
): TerrainReach {
  let byRange = postReaches.get(world);
  if (byRange === undefined) {
    byRange = new Map();
    postReaches.set(world, byRange);
  }
  let held = byRange.get(range);
  if (held === undefined) {
    held = new Map();
    byRange.set(range, held);
  }
  const found = terrainReach(world, content, terrain, hx, hy, range, held.get(post));
  held.set(post, found);
  return found;
}

/** Forget the reaches of posts no longer alive. */
export function dropFallenPostReaches(world: World): void {
  for (const held of postReaches.get(world)?.values() ?? []) {
    for (const post of held.keys()) if (!world.isAlive(post)) held.delete(post);
  }
}
