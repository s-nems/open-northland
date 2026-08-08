import type { ContentSet } from '@open-northland/data';
import { Building, ResourceFootprint } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { type BlockOverlay, LayeredBlocks } from '../../nav/block-overlay.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingBlockedCells } from './building-blocked-cache.js';
import { resourceBlockedCells } from './resource-blocked-cache.js';

// The lazy route-region memo over the building and resource walk-block overlay: the "clear cell sealed
// inside blocker walls" signal that static terrain components cannot give. Derived state, never hashed.

/**
 * The flood cap that separates a provable pocket from the open world, in expanded nodes. Approximation:
 * a coverage knob sized above the largest observed sealed pocket of 494 nodes, not a decoded distance.
 */
export const ROUTE_REGION_POCKET_CAP = 512;

/** Label of every node not proved to sit in a sealed pocket. */
const OPEN_REGION = -1;

/** In-flight label of the current flood's own nodes. A flood that steps onto a same-epoch node without
 *  this label has joined an earlier capped sweep's region, which proves the union larger than the cap, so
 *  it labels itself open even when its own remainder exhausts. The final pass overwrites every visited
 *  node, so this never escapes a flood. */
const PENDING_REGION = -2;

/** Int32 stamp ceiling; on the (practically unreachable) wrap, clear the stamps so no stale slot can
 *  collide with a reused epoch value - the pathfinding-scratch rule. */
const MAX_EPOCH = 2 ** 31 - 1;

interface RouteRegionCache {
  readonly terrain: TerrainGraph;
  /** The overlay inputs the labels were computed under - any drift invalidates every label. The
   *  content ref mirrors the building cache's own key (a swap can move cells with no generation bump). */
  content: ContentSet | null;
  buildingGeneration: number;
  buildingValueGeneration: number;
  resourceGeneration: number;
  /** Composed building + resource overlay for the current epoch's floods. */
  blocked: BlockOverlay;
  /** labels[n] is valid only while stamps[n] === epoch - the pathfinding-scratch reuse pattern, so an
   *  epoch bump invalidates every label in O(1). */
  readonly labels: Int32Array;
  readonly stamps: Int32Array;
  epoch: number;
  nextPocket: number;
  readonly queue: NodeId[];
  readonly steps: StepBuffer;
}

const cacheByWorld = new WeakMap<World, RouteRegionCache>();

/**
 * Route-reachability verdicts over the building and resource walk-block overlay. A verdict is a pure
 * function of terrain and overlay, never of query history: a pocket label is minted only for a fully
 * enumerated region and every other flood outcome collapses to the shared open label, so a cold cache
 * answers exactly like a warm one.
 */
export class RouteRegions {
  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly cache: RouteRegionCache,
  ) {}

  /**
   * Whether a walk from `from` to `to` provably has no route under the overlay: one endpoint sits in a
   * sealed pocket the other is not in. True is a proof; false is not a routability promise, since two open
   * endpoints may be walled apart beyond the cap, unit bodies are not in this overlay, and a blocked
   * endpoint always reads false because findPath exempts a blocked start.
   */
  unroutable(from: NodeId, to: NodeId): boolean {
    if (from === to) return false;
    const cache = this.cache;
    this.refresh(cache);
    const { terrain, blocked } = cache;
    if (!terrain.isWalkable(from) || blocked.has(from)) return false;
    if (!terrain.isWalkable(to) || blocked.has(to)) return false;
    const a = this.regionOf(from);
    const b = this.regionOf(to);
    if (a === OPEN_REGION && b === OPEN_REGION) return false;
    return a !== b;
  }

  /**
   * Whether `node` provably sits in a sealed pocket. False for a blocked or unwalkable node and for
   * everything the capped flood cannot prove - the same fail-open contract as {@link unroutable}. A
   * pocketed proxy inverts {@link unroutable} (every open spot reads unroutable), so a pick whose `from`
   * stands in for the walker rather than being its cell must disable that veto instead.
   */
  pocketed(node: NodeId): boolean {
    const cache = this.cache;
    this.refresh(cache);
    const { terrain, blocked } = cache;
    if (!terrain.isWalkable(node) || blocked.has(node)) return false;
    return this.regionOf(node) !== OPEN_REGION;
  }

  /** Re-key the labels against the overlay inputs, invalidating every label when any moved. Ran per
   *  verdict (three generation reads), so a held instance can never serve a stale epoch. */
  private refresh(cache: RouteRegionCache): void {
    const world = this.world;
    const content = this.ctx.content;
    const buildingGeneration = world.componentGeneration(Building);
    const buildingValueGeneration = world.componentValueGeneration(Building);
    const resourceGeneration = world.componentGeneration(ResourceFootprint);
    if (
      cache.content === content &&
      cache.buildingGeneration === buildingGeneration &&
      cache.buildingValueGeneration === buildingValueGeneration &&
      cache.resourceGeneration === resourceGeneration
    ) {
      return;
    }
    cache.content = content;
    cache.buildingGeneration = buildingGeneration;
    cache.buildingValueGeneration = buildingValueGeneration;
    cache.resourceGeneration = resourceGeneration;
    cache.blocked = new LayeredBlocks([
      buildingBlockedCells(world, this.ctx, cache.terrain),
      resourceBlockedCells(world, cache.terrain),
    ]);
    cache.nextPocket = 0;
    if (cache.epoch >= MAX_EPOCH) {
      cache.stamps.fill(0);
      cache.epoch = 0;
    }
    cache.epoch += 1;
  }

  /** The region label of a passable node: a pocket id when a flood enumerated its whole region within
   *  the cap without joining an earlier sweep, else {@link OPEN_REGION}. Every visited node is labeled
   *  in one pass, so a pocket is flooded once per epoch and open ground accretes swept patches that
   *  later floods join and stop at. */
  private regionOf(node: NodeId): number {
    const { terrain, labels, stamps, epoch, queue, steps, blocked } = this.cache;
    const known = labels[node];
    if (stamps[node] === epoch && known !== undefined) return known;
    queue.length = 0;
    queue.push(node);
    stamps[node] = epoch;
    labels[node] = PENDING_REGION;
    let expanded = 0;
    let sealed = true;
    // The array iterator re-reads `length`, so `queue` is a live BFS queue AND the visited list.
    for (const cur of queue) {
      if (expanded >= ROUTE_REGION_POCKET_CAP) {
        sealed = false;
        break;
      }
      expanded += 1;
      terrain.stepsInto(cur, blocked, steps);
      for (let i = 0; i < steps.length && sealed; i++) {
        const next = steps.at(i).node;
        if (stamps[next] === epoch) {
          if (labels[next] !== PENDING_REGION) sealed = false; // joined an earlier sweep: provably open
        } else {
          stamps[next] = epoch;
          labels[next] = PENDING_REGION;
          queue.push(next);
        }
      }
      if (!sealed) break;
    }
    const label = sealed ? this.cache.nextPocket++ : OPEN_REGION;
    for (const visited of queue) labels[visited] = label;
    return label;
  }
}

/**
 * The world's route-region memo over the current building and resource walk-block overlay. Verdicts re-key
 * against the overlay inputs on every call, so holding the instance is safe. A verdict is O(1) on labeled
 * ground, otherwise one flood of at most {@link ROUTE_REGION_POCKET_CAP} expansions; every blocker change
 * re-opens the whole map's labels, so the veto belongs last in a pick's gate chain.
 */
export function routeRegions(world: World, ctx: SystemContext, terrain: TerrainGraph): RouteRegions {
  let cache = cacheByWorld.get(world);
  if (cache === undefined || cache.terrain !== terrain) {
    cache = {
      terrain,
      content: null,
      buildingGeneration: -1,
      buildingValueGeneration: -1,
      resourceGeneration: -1,
      blocked: new LayeredBlocks([]),
      labels: new Int32Array(terrain.nodeCount),
      stamps: new Int32Array(terrain.nodeCount),
      epoch: 0,
      nextPocket: 0,
      queue: [],
      steps: new StepBuffer(),
    };
    cacheByWorld.set(world, cache);
  }
  return new RouteRegions(world, ctx, cache);
}
