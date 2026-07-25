import type { ContentSet } from '@open-northland/data';
import { Building, ResourceFootprint } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { LayeredBlocks } from '../../nav/block-overlay.js';
import { type BlockOverlay, type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { buildingBlockedCells } from './building-blocked-cache.js';
import { resourceBlockedCells } from './resource-blocked-cache.js';

// The lazy route-region memo over the building + resource walk-block overlay - the target picks'
// "clear cell sealed inside blocker walls" signal that neither static components
// (TerrainGraph.componentOf) nor the bounded per-settler failed-goal memo can give. DERIVED state,
// never hashed, never stored on an entity.

/**
 * The flood cap that separates a provable pocket from the open world, in expanded nodes. Sized above
 * the sealed-pocket class the pathfinder profiled (a 494-node overlay pocket, see find-path.ts's
 * flood guard); a pure performance/coverage knob, not a decoded distance (named approximation).
 */
export const ROUTE_REGION_POCKET_CAP = 512;

/** Label of every node not proved to sit in a sealed pocket. See {@link RouteRegions.unroutable}
 *  for what "open" does and does not promise. */
const OPEN_REGION = -1;

/** In-flight label of the current flood's own nodes. A flood that steps onto a same-epoch node NOT
 *  carrying this label has joined an earlier capped sweep's region (a pocket's enumeration is
 *  complete, so only open-labeled ground can border unstamped nodes), which proves the union larger
 *  than the cap: the flood must label itself open even when its own remainder exhausts. Never visible
 *  outside a flood - the final labeling pass overwrites every visited node. */
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
 * Route-reachability verdicts over the building + resource walk-block overlay, resolved through
 * {@link routeRegions}. Verdicts are pure functions of (terrain, overlay), never of query history:
 * a pocket label is minted only for a completely enumerated region, and every other flood outcome
 * collapses to the one shared open label, so a cold cache answers exactly like a warm one (the sim
 * contract for a results-invisible memo cache).
 */
export class RouteRegions {
  constructor(
    private readonly world: World,
    private readonly ctx: SystemContext,
    private readonly cache: RouteRegionCache,
  ) {}

  /**
   * Whether a walk from `from` to `to` PROVABLY has no route under the building + resource overlay:
   * one endpoint sits in a sealed pocket (an exhaustively enumerated region of at most
   * {@link ROUTE_REGION_POCKET_CAP} nodes) that the other endpoint is not in. True is a proof and the
   * only proof this memo issues; every other case fails open to the route + failed-goal-memo path.
   * False is therefore not a routability promise: two open endpoints may be walled apart (regions
   * beyond the cap are never compared), unit bodies are not in this overlay, and a blocked endpoint
   * always reads false - a blocked GOAL is the picks' existing gates' verdict, and a blocked START is
   * findPath's step-off exemption (the walker may enter any adjacent region, so no single region
   * describes it).
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
 * The world's route-region memo over the current building + resource walk-block overlay. Resolve per
 * scan and query {@link RouteRegions.unroutable}; verdicts re-key against the overlay inputs on every
 * call, so holding the instance is safe. First use allocates two node-sized Int32 arrays per world
 * (the pathfinding-scratch pattern). Cost per verdict: O(1) on labeled ground; otherwise one flood of
 * at most {@link ROUTE_REGION_POCKET_CAP} expansions that also stops on contact with ground an
 * earlier flood of the epoch already swept. Every blocker change re-opens the whole map's labels, so
 * the flood cost recurs per scan origin per epoch; the veto sits last in its pick's gate chain to
 * keep that off candidates cheaper gates already rejected.
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
