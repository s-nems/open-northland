import type { ContentSet } from '@open-northland/data';
import {
  GOODS_SEARCH_RANGE_NODES,
  Position,
  SIGNPOST_LINK_BUDGET,
  SIGNPOST_LINK_RANGE_NODES,
  Signpost,
} from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeHxOfPosition, nodeHyOfPosition } from '../../nav/halfcell.js';
import { floodInspected, floodReach, originalReachBudget, type ReachSearch } from '../../nav/range-search.js';
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

/** A range search's hex range and the ground resistance it spends. */
export interface ReachSpan {
  readonly range: number;
  readonly budget: number;
}

export const GOODS_SEARCH_SPAN: ReachSpan = {
  range: GOODS_SEARCH_RANGE_NODES,
  budget: originalReachBudget(GOODS_SEARCH_RANGE_NODES),
};

export const SIGNPOST_LINK_SPAN: ReachSpan = {
  range: SIGNPOST_LINK_RANGE_NODES,
  budget: SIGNPOST_LINK_BUDGET,
};

export interface TerrainReach extends ReachSearch {
  readonly terrain: TerrainGraph;
  readonly hx: number;
  readonly hy: number;
  readonly span: ReachSpan;
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
  span: ReachSpan,
  held?: TerrainReach,
): TerrainReach {
  const mask = signpostMask(world, content, terrain);
  const maskVersion = mask.version;
  const roadRevision = terrain.mirroredRoadRevision;
  const sameOrigin =
    held?.terrain === terrain && held.mask === mask && held.hx === hx && held.hy === hy && held.span === span;
  if (sameOrigin && held.maskVersion === maskVersion && held.roadRevision === roadRevision) return held;
  if (sameOrigin && !readNodeChanged(held, mask, terrain)) {
    held.maskVersion = maskVersion;
    held.roadRevision = roadRevision;
    held.resistanceClock = terrain.resistanceClock;
    return held;
  }
  return {
    ...floodReach(terrain, mask.levelled(), hx, hy, span.range, span.budget),
    terrain,
    hx,
    hy,
    span,
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

/** Each signpost's reach per span, the link pass's and the goods search's. */
const postReaches = new WeakMap<World, Map<ReachSpan, Map<Entity, TerrainReach>>>();

/** {@link terrainReach} from signpost `post` standing on `(hx, hy)`, kept per post until it falls. */
export function postTerrainReach(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph,
  post: Entity,
  hx: number,
  hy: number,
  span: ReachSpan,
): TerrainReach {
  let bySpan = postReaches.get(world);
  if (bySpan === undefined) {
    bySpan = new Map();
    postReaches.set(world, bySpan);
  }
  let held = bySpan.get(span);
  if (held === undefined) {
    held = new Map();
    bySpan.set(span, held);
  }
  const found = terrainReach(world, content, terrain, hx, hy, span, held.get(post));
  held.set(post, found);
  return found;
}

/**
 * Flood every standing post's reach before the first tick of a restored world, where a load pause is
 * expected: a held reach is only returned while it equals a fresh flood, so warming changes no answer,
 * and the first link pass and goods searches no longer flood every post inside one tick.
 */
export function warmPostReaches(world: World, content: ContentSet, terrain: TerrainGraph): void {
  for (const post of world.query(Signpost, Position)) {
    const p = world.get(post, Position);
    const hx = nodeHxOfPosition(p.x, p.y);
    const hy = nodeHyOfPosition(p.y);
    postTerrainReach(world, content, terrain, post, hx, hy, SIGNPOST_LINK_SPAN);
    postTerrainReach(world, content, terrain, post, hx, hy, GOODS_SEARCH_SPAN);
  }
}

/** Forget the reaches of posts no longer alive. */
export function dropFallenPostReaches(world: World): void {
  for (const held of postReaches.get(world)?.values() ?? []) {
    for (const post of held.keys()) if (!world.isAlive(post)) held.delete(post);
  }
}
