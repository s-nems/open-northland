import type { ContentSet } from '@open-northland/data';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeArea } from '../../nav/halfcell.js';
import { floodReach, type ReachArea } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { type WalkBlockMask, walkBlockMask } from '../footprint/walk-block-mask.js';
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
  /** The blocks and roads over {@link searched} when the flood ran. */
  readonly localKey: string;
  readonly searched: NodeArea;
  readonly area: ReachArea;
}

/** A token over the walk blocks and roads on the nodes of `box`: every block and road revision it sums
 *  only grows, so it changes exactly when one of them moves. */
function localKeyOf(world: World, mask: WalkBlockMask, box: NodeArea): string {
  return `${mask.areaVersion(box)}:${roadAreaKey(world, box)}`;
}

/** A held search survives every change outside the nodes its flood inspected. */
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
  const mask = walkBlockMask(world, { content }, terrain);
  if (sameOrigin && held.localKey === localKeyOf(world, mask, held.searched)) {
    held.version = version;
    return held;
  }
  const { area, searched } = floodReach(terrain, mask.levelled(), hx, hy, range);
  return { terrain, hx, hy, range, version, localKey: localKeyOf(world, mask, searched), searched, area };
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
