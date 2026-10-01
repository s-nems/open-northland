import type { World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { type NodeId, StepBuffer, type TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { type WalkBlockMask, walkBlockMask } from './walk-block-mask.js';

// The lazy route-region memo over the building, resource and landscape walk-block overlay: the "clear cell
// sealed inside blocker walls" signal that static terrain components cannot give. Unit bodies are left
// out: the labels key on the structures only. Derived state, never hashed.

/**
 * The flood cap that separates a provable pocket from the open world, in expanded nodes. Approximation:
 * a coverage knob sized above the largest observed sealed pocket of 494 nodes, not a decoded distance.
 */
export const ROUTE_REGION_POCKET_CAP = 512;

/** Label of every node not proved to sit in a sealed pocket. */
const OPEN_REGION = -1;

/** In-flight label of the current flood's own nodes. A flood that steps onto a validly labeled node
 *  without this label has joined an open region, which proves the union larger than the cap, so it labels
 *  itself open even when its own remainder exhausts. The final pass overwrites every visited node, so
 *  this never escapes a flood. */
const PENDING_REGION = -2;

/** Int32 stamp ceiling; on the (practically unreachable) wrap, clear the stamps so no stale slot can
 *  collide with a reused value - the pathfinding-scratch rule. */
const MAX_STAMP = 2 ** 31 - 1;

/** Pocket ids minted before the labels start over, bounding {@link RouteRegionCache.retired}. */
const POCKET_ID_LIMIT = 2 ** 20;

/** Every node whose step edges a block flip at the origin can add or remove, as offsets from it: the
 *  flipped node's own steps (E/W, the diagonals, N/S) and both ends of each diagonal it flanks. */
const FLIP_REACH_X = 1;
const FLIP_REACH_Y = 2;

interface RouteRegionCache {
  readonly terrain: TerrainGraph;
  /** The walk-block union the labels read; its flips since the last refresh re-key them. */
  readonly mask: WalkBlockMask;
  /** labels[n] is valid only while stamps[n] === epoch and, for a pocket id, that pocket is not
   *  retired - the pathfinding-scratch reuse pattern, so an epoch bump drops every label in O(1). */
  readonly labels: Int32Array;
  readonly stamps: Int32Array;
  epoch: number;
  nextPocket: number;
  /** retired[p] is 1 once a block flip may have reshaped pocket p, so its nodes read unlabeled. */
  retired: Uint8Array;
  /** Visit marks of one refresh's eager re-floods, valid while equal to {@link pass}. */
  readonly marks: Int32Array;
  pass: number;
  readonly queue: NodeId[];
  readonly steps: StepBuffer;
  /** A blocked start's exits, apart from {@link steps}, which the region floods reuse. */
  readonly exits: StepBuffer;
  /** Scratch: the mask's flips since the last refresh. */
  readonly flips: NodeId[];
}

const cacheByWorld = new WeakMap<World, RouteRegionCache>();

/**
 * Route-reachability verdicts over the building and resource walk-block overlay. A verdict is a pure
 * function of terrain and overlay, never of query history: a pocket label is minted only for a fully
 * enumerated region and every other flood outcome collapses to the shared open label, so a cold cache
 * answers exactly like a warm one.
 */
export class RouteRegions {
  constructor(private readonly cache: RouteRegionCache) {}

  /** Whether a unit could stand on `node` under the structure overlay the verdicts read: walkable and
   *  clear of every building, resource and landscape block. */
  standable(node: NodeId): boolean {
    const blocked = this.refresh(this.cache);
    return this.cache.terrain.isWalkable(node) && !blocked.has(node);
  }

  /**
   * Whether a walk from `from` to `to` provably has no route under the overlay: one endpoint sits in a
   * sealed pocket the other is not in. True is a proof; false is not a routability promise, since two open
   * endpoints may be walled apart beyond the cap, and unit bodies are not in this overlay. A
   * blocked `from` is judged by the nodes it can step out to, as findPath exempts a blocked start, and
   * reads false with none; a blocked `to` reads false, since findPath rejects that goal first.
   */
  unroutable(from: NodeId, to: NodeId): boolean {
    if (from === to) return false;
    const cache = this.cache;
    const blocked = this.refresh(cache);
    const { terrain, exits } = cache;
    if (!terrain.isWalkable(from)) return false;
    if (!terrain.isWalkable(to) || blocked.has(to)) return false;
    const target = this.regionOf(to, blocked);
    if (!blocked.has(from)) return this.regionOf(from, blocked) !== target;
    terrain.stepsInto(from, blocked, exits);
    // No exit at all proves nothing: a walker deep in a building body leaves it by the door, not a step.
    if (exits.length === 0) return false;
    for (let i = 0; i < exits.length; i++) {
      if (this.regionOf(exits.at(i).node, blocked) === target) return false;
    }
    return true;
  }

  /**
   * Whether `node` provably sits in a sealed pocket, a blocked node when every node it steps out to lies
   * in a pocket, as {@link unroutable} judges it. False for an unwalkable node and for everything the
   * capped flood cannot prove. A pocketed proxy inverts {@link unroutable} (every open spot reads
   * unroutable), so a pick whose `from` stands in for the walker rather than being its cell must disable
   * that veto instead.
   */
  pocketed(node: NodeId): boolean {
    const cache = this.cache;
    const blocked = this.refresh(cache);
    const { terrain, exits } = cache;
    if (!terrain.isWalkable(node)) return false;
    if (!blocked.has(node)) return this.regionOf(node, blocked) !== OPEN_REGION;
    terrain.stepsInto(node, blocked, exits);
    if (exits.length === 0) return false;
    for (let i = 0; i < exits.length; i++) {
      if (this.regionOf(exits.at(i).node, blocked) === OPEN_REGION) return false;
    }
    return true;
  }

  /** Re-key the labels with the mask's flips since the last verdict, dropping them all when the mask
   *  lost track, and return the levelled mask. Ran per verdict, so a held instance never serves a stale
   *  label. */
  private refresh(cache: RouteRegionCache): BlockOverlay {
    const flips = cache.flips;
    flips.length = 0;
    if (!cache.mask.takeFlips(flips)) dropLabels(cache);
    const blocked = cache.mask.levelled();
    if (flips.length > 0) this.applyFlips(cache, blocked);
    return blocked;
  }

  /**
   * Re-key the labels after the {@link RouteRegionCache.flips} moved in the mask. A flip
   * changes only edges between nodes in its reach, so it can merge or split exactly the regions that hold
   * one of those nodes: such pockets are retired for a lazy re-flood. Freeing only grows regions, which
   * keeps an open label true; a new block can split a sealed piece off open ground, so each node in its
   * reach is re-flooded eagerly, ignoring the labels that piece may still carry.
   */
  private applyFlips(cache: RouteRegionCache, blocked: BlockOverlay): void {
    const { terrain, flips, stamps, labels } = cache;
    const epoch = cache.epoch;
    // A node flipped back since is handled as freed, which only drops labels.
    let blocking = false;
    for (const node of flips) {
      if (blocked.has(node)) blocking = true;
      this.forEachInReach(node, (near) => {
        const label = labels[near];
        if (stamps[near] === epoch && label !== undefined && label >= 0) cache.retired[label] = 1;
      });
      stamps[node] = 0;
    }
    if (!blocking) return;
    if (cache.pass >= MAX_STAMP) {
      cache.marks.fill(0);
      cache.pass = 0;
    }
    cache.pass += 1;
    for (const node of flips) {
      if (!blocked.has(node)) continue;
      this.forEachInReach(node, (near) => {
        if (cache.marks[near] !== cache.pass && terrain.isWalkable(near) && !blocked.has(near)) {
          this.reflood(near, blocked);
        }
      });
    }
  }

  /** Call `visit` with every in-bounds node within a flip's reach of `node`, itself included. */
  private forEachInReach(node: NodeId, visit: (near: NodeId) => void): void {
    const terrain = this.cache.terrain;
    const x = terrain.xOf(node);
    const y = terrain.yOf(node);
    for (let dy = -FLIP_REACH_Y; dy <= FLIP_REACH_Y; dy++) {
      for (let dx = -FLIP_REACH_X; dx <= FLIP_REACH_X; dx++) {
        if (terrain.inBounds(x + dx, y + dy)) visit(terrain.nodeAt(x + dx, y + dy));
      }
    }
  }

  /** The region label of a passable node: a pocket id when a flood enumerated its whole region within
   *  the cap without joining an open region, else {@link OPEN_REGION}. Every visited node is labeled in
   *  one pass, so a pocket is flooded once until a flip retires it, and open ground accretes swept
   *  patches that later floods join and stop at. */
  private regionOf(node: NodeId, blocked: BlockOverlay): number {
    const { terrain, labels, stamps, epoch, queue, steps, retired } = this.cache;
    const known = labels[node];
    if (stamps[node] === epoch && known !== undefined && (known < 0 || retired[known] === 0)) return known;
    let queued = 1;
    queue[0] = node;
    stamps[node] = epoch;
    labels[node] = PENDING_REGION;
    let expanded = 0;
    let sealed = true;
    // Reuse the queue backing store; only its active prefix belongs to this flood.
    for (let cursor = 0; cursor < queued; cursor++) {
      const cur = queue[cursor];
      if (cur === undefined) throw new Error('route region queue missing an active node');
      if (expanded >= ROUTE_REGION_POCKET_CAP) {
        sealed = false;
        break;
      }
      expanded += 1;
      terrain.stepsInto(cur, blocked, steps);
      for (let i = 0; i < steps.length && sealed; i++) {
        const next = steps.at(i).node;
        const label = labels[next];
        if (stamps[next] === epoch && label !== undefined && (label < 0 || retired[label] === 0)) {
          if (label !== PENDING_REGION) sealed = false; // joined a labeled region, which is open
        } else {
          stamps[next] = epoch;
          labels[next] = PENDING_REGION;
          queue[queued++] = next;
        }
      }
      if (!sealed) break;
    }
    return this.label(queued, sealed);
  }

  /**
   * Label the open or sealed region holding `seed`, reading no earlier label: one a new block made stale
   * may still claim open ground that is now a sealed piece. Joining another of this refresh's floods
   * still proves the region open, since each of them read the current mask alone.
   */
  private reflood(seed: NodeId, blocked: BlockOverlay): void {
    const cache = this.cache;
    const { terrain, labels, stamps, epoch, queue, steps, marks, pass } = cache;
    let queued = 1;
    queue[0] = seed;
    marks[seed] = pass;
    stamps[seed] = epoch;
    labels[seed] = PENDING_REGION;
    let expanded = 0;
    let sealed = true;
    for (let cursor = 0; cursor < queued && sealed; cursor++) {
      const cur = queue[cursor];
      if (cur === undefined) throw new Error('route region queue missing an active node');
      if (expanded >= ROUTE_REGION_POCKET_CAP) {
        sealed = false;
        break;
      }
      expanded += 1;
      terrain.stepsInto(cur, blocked, steps);
      for (let i = 0; i < steps.length && sealed; i++) {
        const next = steps.at(i).node;
        if (marks[next] === pass) {
          if (labels[next] !== PENDING_REGION) sealed = false; // joined an earlier capped re-flood
        } else {
          marks[next] = pass;
          stamps[next] = epoch;
          labels[next] = PENDING_REGION;
          queue[queued++] = next;
        }
      }
    }
    this.label(queued, sealed);
  }

  /** Stamp the queue's first `queued` nodes with a fresh pocket id when `sealed`, else open. */
  private label(queued: number, sealed: boolean): number {
    const cache = this.cache;
    const label = sealed ? this.mintPocket() : OPEN_REGION;
    const { queue, labels } = cache;
    for (let i = 0; i < queued; i++) {
      const visited = queue[i];
      if (visited !== undefined) labels[visited] = label;
    }
    return label;
  }

  private mintPocket(): number {
    const cache = this.cache;
    // Ids past the limit start over, and every label with them. The flood being labeled keeps its
    // verdict but none of its labels.
    if (cache.nextPocket >= POCKET_ID_LIMIT) dropLabels(cache);
    if (cache.nextPocket >= cache.retired.length) {
      const grown = new Uint8Array(cache.retired.length * 2);
      grown.set(cache.retired);
      cache.retired = grown;
    }
    return cache.nextPocket++;
  }
}

function dropLabels(cache: RouteRegionCache): void {
  cache.retired.fill(0, 0, cache.nextPocket);
  cache.nextPocket = 0;
  if (cache.epoch >= MAX_STAMP) {
    cache.stamps.fill(0);
    cache.epoch = 0;
  }
  cache.epoch += 1;
}

/** Pocket ids the first cache has room for before growing. */
const INITIAL_POCKET_IDS = 256;

/**
 * The world's route-region memo over the current building and resource walk-block overlay. Verdicts re-key
 * against the overlay layers on every call, so holding the instance is safe. A verdict is O(1) on labeled
 * ground, otherwise one flood of at most {@link ROUTE_REGION_POCKET_CAP} expansions; a blocker change
 * re-floods only the regions beside it.
 */
export function routeRegions(world: World, ctx: ContentContext, terrain: TerrainGraph): RouteRegions {
  let cache = cacheByWorld.get(world);
  if (cache === undefined || cache.terrain !== terrain) {
    cache = {
      terrain,
      mask: walkBlockMask(world, ctx, terrain),
      labels: new Int32Array(terrain.nodeCount),
      stamps: new Int32Array(terrain.nodeCount),
      epoch: 0,
      nextPocket: 0,
      retired: new Uint8Array(INITIAL_POCKET_IDS),
      marks: new Int32Array(terrain.nodeCount),
      pass: 0,
      queue: [],
      steps: new StepBuffer(),
      exits: new StepBuffer(),
      flips: [],
    };
    cacheByWorld.set(world, cache);
  }
  return new RouteRegions(cache);
}
