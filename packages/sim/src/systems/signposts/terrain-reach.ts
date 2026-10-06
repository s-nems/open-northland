import type { ContentSet } from '@open-northland/data';
import type { Entity, World } from '../../ecs/world.js';
import { floodInspected, floodReach, type ReachSearch } from '../../nav/range-search.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { type WalkBlockMask, walkBlockMask } from '../footprint/walk-block-mask.js';
import { syncRoadLane } from '../roads/index.js';

/** One context object per content set, so a per-call mask read allocates nothing. */
const contexts = new WeakMap<ContentSet, { readonly content: ContentSet }>();

/** The world's walk-block mask, levelled now, with the roads mirrored into `terrain` first. */
export function signpostMask(world: World, content: ContentSet, terrain: TerrainGraph): WalkBlockMask {
  syncRoadLane(world, terrain);
  let ctx = contexts.get(content);
  if (ctx === undefined) {
    ctx = { content };
    contexts.set(content, ctx);
  }
  return walkBlockMask(world, ctx, terrain);
}

export function signpostTerrainKey(world: World, content: ContentSet, terrain: TerrainGraph): string {
  return `${signpostMask(world, content, terrain).version}:${terrain.mirroredRoadRevision}`;
}

export interface TerrainReach extends ReachSearch {
  readonly terrain: TerrainGraph;
  readonly hx: number;
  readonly hy: number;
  readonly range: number;
  /** The walk-block mask the flood read, and its version, the terrain's mirrored road revision and its
   *  resistance clock at the latest moment the answer was known to hold. */
  readonly mask: WalkBlockMask;
  maskVersion: number;
  roadRevision: number;
  resistanceClock: number;
}

/** A held search survives every change to a node its flood did not read. */
export function terrainReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  hx: number,
  hy: number,
  range: number,
  held?: TerrainReach,
): TerrainReach {
  const mask = signpostMask(world, content, terrain);
  const maskVersion = mask.version;
  const roadRevision = terrain.mirroredRoadRevision;
  const sameOrigin =
    held?.terrain === terrain &&
    held.mask === mask &&
    held.hx === hx &&
    held.hy === hy &&
    held.range === range;
  if (sameOrigin && held.maskVersion === maskVersion && held.roadRevision === roadRevision) return held;
  if (sameOrigin && !readNodeChanged(held, mask, terrain)) {
    held.maskVersion = maskVersion;
    held.roadRevision = roadRevision;
    held.resistanceClock = terrain.resistanceClock;
    return held;
  }
  return {
    ...floodReach(terrain, mask.levelled(), hx, hy, range),
    terrain,
    hx,
    hy,
    range,
    mask,
    maskVersion,
    roadRevision,
    resistanceClock: terrain.resistanceClock,
  };
}

/** Whether a node the held flood read changed its blocker or resistance since the answer last held. */
function readNodeChanged(held: TerrainReach, mask: WalkBlockMask, terrain: TerrainGraph): boolean {
  const read = (x: number, y: number): boolean => floodInspected(held, x, y);
  return (
    mask.flippedSince(held.searched, held.maskVersion, read) ||
    terrain.resistanceChangedSince(held.searched, held.resistanceClock, read)
  );
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
