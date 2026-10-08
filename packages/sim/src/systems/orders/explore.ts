import {
  CurrentAtomic,
  ExploreOrder,
  type ExploreSweep,
  FOG_MODE,
  MealBreak,
  NoRegeneration,
  OrderQueue,
  Owner,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  SettlerNeeds,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import { NO_COMPONENT, type NodeId, type TerrainGraph } from '../../nav/terrain/index.js';
import { BattleFront, holdsGround } from '../conflict/battle-alert.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { carriesNeeds, NEED_CRITICAL_THRESHOLD, needLevel } from '../lifecycle/needs/index.js';
import { clearNavState, isTravelling, redirectRoute } from '../movement/nav-state.js';
import { isScoutJob } from '../readviews/index.js';
import { cellOfNode, FOG_STATE } from '../vision/index.js';
import { isOrderableSettler, supersedeStandingOrders } from './guards.js';
import { breaksForMeal, startMealBreak } from './meal-break.js';
import { moveUnit } from './movement.js';

/** How many legs in a row a sweep may find it cannot walk before it counts the rest of its landmass as
 *  out of reach and finishes. Authored. */
const EXPLORE_MAX_FAILED_LEGS = 16;

/** How many of the latest unwalkable goals a sweep keeps steering around. Authored; an older pocket
 *  costs at most a failed leg again. */
const EXPLORE_REMEMBERED_UNREACHABLE = 64;

/** How close, on each half-cell axis, a pick may come to a goal the sweep could not walk to. Authored:
 *  ground walled off from the scout is a patch, not a single node. */
const UNREACHABLE_CLEARANCE_NODES = 4;

/** How many fog-cell rings past the nearest unseen one around the sweep's origin a pick still takes,
 *  the nearest of them to the scout winning. Authored: a narrow band keeps the explored ground growing as
 *  rings around the origin, but on an island wider than the scout's sight it walks from one side to the
 *  other for every ring. Of 4, 8, 12 and 16 on grass maps of five shapes, 12 swept fastest overall. */
const SPIRAL_BAND_RINGS = 12;

/** An unseen cell is worth a walk only when at least {@link PATCH_MIN_UNSEEN_LAND} unseen land cells of
 *  the scout's landmass lie within this many fog cells of it, itself included. Authored: the strips a
 *  sight circle leaves along a shore or a map edge, up to about two cells wide, are not worth a leg each.
 *  On grass maps of five shapes a sweep ends 8-30% sooner and leaves at most 2.4% of the map unseen. */
const PATCH_RADIUS_CELLS = 3;
const PATCH_MIN_UNSEEN_LAND = 20;

/**
 * Send one owned scout exploring - see the command doc. The stamp is all the order does;
 * {@link exploreOrderSystem} walks the sweep out one leg at a time. Returns whether the order was taken.
 */
export function explore(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'explore' }>,
): boolean {
  if (ctx.terrain === undefined) return false; // mapless sim: nothing to reveal
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return false;
  if (!isScoutJob(ctx.content, world.get(e, Settler).jobType)) return false; // only scouts explore
  // The walk it was on is superseded, so the first leg goes out this tick; a clip in flight plays to its
  // end, since the sweep below waits for the scout to be free anyway.
  world.remove(e, PlayerOrder);
  supersedeStandingOrders(world, e);
  clearNavState(world, e);
  world.add(e, ExploreOrder, {
    origin: standingNode(world, ctx.terrain, e),
    frontierRing: 0,
    leg: null,
    unreachable: [],
    failedLegs: 0,
  });
  return true;
}

/**
 * Walk a standing {@link ExploreOrder} out: a free scout is sent to the next unseen walkable node of its
 * landmass, in rings around where the order was given, and a walking one is re-aimed once its goal comes
 * into view. The order ends, with an `explorationFinished` event, once no such node is left. A hungry scout
 * breaks for a meal and a tired one is left to the needs ladder until it has slept; the sweep then goes
 * on from wherever the scout stands.
 *
 * Runs after the player-order system retires the arrived walk and before the planner could re-task the
 * scout, so one leg ends and the next starts on the same tick.
 *
 * Project addition: the original's explore order sweeps a box around a picked point, picking one of a
 * handful of unexplored points at random; this sweeps the whole landmass outward from where the order was
 * given (see {@link spiralPick}), deterministically.
 */
export const exploreOrderSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless: no orders were issuable
  let front: BattleFront | undefined;
  const onAlert = (e: Entity): boolean => {
    front ??= new BattleFront(world, ctx); // built only once a tired scout asks
    return holdsGround(world, ctx, e, front);
  };
  for (const e of world.canonicalQuery(Settler, ExploreOrder)) {
    const owner = world.tryGet(e, Owner);
    if (owner === undefined || !isScoutJob(ctx.content, world.get(e, Settler).jobType)) {
      world.remove(e, ExploreOrder); // re-professioned or unowned mid-sweep - the intent dies
      continue;
    }
    if (world.has(e, MealBreak)) {
      // Hunger took it off its leg, maybe before its first step: that leg is no evidence of a wall.
      const held = world.get(e, ExploreOrder);
      if (held.leg !== null && !held.leg.failed) world.mut(e, ExploreOrder).leg = null;
      continue;
    }
    if (world.has(e, CurrentAtomic)) continue;
    const order = world.get(e, ExploreOrder);
    if (world.has(e, PlayerOrder)) {
      reaimRevealedLeg(world, ctx, terrain, e, owner.player, order, onAlert);
      continue;
    }
    if (breaksForMeal(world, ctx, e)) {
      startMealBreak(world, e);
      continue;
    }
    if (restsBeforeNextLeg(world, ctx, e, onAlert)) continue; // the ladder lays it down this pass
    const from = standingNode(world, terrain, e);
    let { unreachable, failedLegs } = order;
    if (order.leg !== null && (order.leg.failed || order.leg.from === from)) {
      // No route, or free on the node the last leg left from: that walk never got under way.
      unreachable = [...unreachable, order.leg.to].slice(-EXPLORE_REMEMBERED_UNREACHABLE);
      failedLegs++;
    } else {
      failedLegs = 0;
    }
    const pick =
      failedLegs > EXPLORE_MAX_FAILED_LEGS
        ? null
        : spiralPick(world, ctx, terrain, owner.player, { ...order, unreachable }, from);
    if (pick === null) {
      world.remove(e, ExploreOrder);
      ctx.events.emit({ kind: 'explorationFinished', entity: e });
      continue;
    }
    const c = terrain.coordsOf(pick.node);
    const queued = world.tryGet(e, OrderQueue)?.orders;
    moveUnit(world, ctx, { kind: 'moveUnit', entity: e, x: c.x, y: c.y });
    // moveUnit drops the order it supersedes and the orders queued behind it; this sweep issued the walk,
    // so both outlive it, the queue waiting for the sweep's end.
    if (queued !== undefined) world.add(e, OrderQueue, { orders: [...queued] });
    world.add(e, ExploreOrder, {
      origin: order.origin,
      frontierRing: pick.ring,
      leg: { from, to: pick.node, failed: false },
      unreachable,
      failedLegs,
    });
  }
};

/** Re-aim a walking scout whose leg's goal has come into view, or shrunk to a sliver not worth the walk,
 *  at the next spiral pick, so it does not walk on into ground it already sees. A tired scout lets the leg run out instead, to sleep at its end. */
function reaimRevealedLeg(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  player: number,
  order: ExploreSweep,
  onAlert: (e: Entity) => boolean,
): void {
  const { leg } = order;
  if (leg === null || !isTravelling(world, e) || world.tryGet(e, PathRequest)?.failed === true) return;
  const from = standingNode(world, terrain, e);
  const patches = unseenPatchesOf(ctx, terrain, player, terrain.componentOf(from));
  const g = terrain.coordsOf(leg.to);
  const goalCell = cellOfNode(g.x, g.y);
  if (patches === null || patches.worthVisiting(goalCell.cx, goalCell.cy)) return;
  if (restsBeforeNextLeg(world, ctx, e, onAlert)) return;
  const pick = spiralPick(world, ctx, terrain, player, order, from);
  const held = world.mut(e, ExploreOrder);
  if (pick === null) {
    // Nothing left to aim at: the leg runs out, then the sweep ends, without a search every tick till then.
    held.leg = null;
    return;
  }
  redirectRoute(world, e, pick.node);
  held.leg = { from, to: pick.node, failed: false };
  held.frontierRing = pick.ring;
}

/** Whether `e` is tired enough to sleep before its next leg, as the needs ladder would let it: a battle
 *  alert keeps the ladder from laying it down, so the sweep walks on. `onAlert` is asked last. */
function restsBeforeNextLeg(
  world: World,
  ctx: SystemContext,
  e: Entity,
  onAlert: (e: Entity) => boolean,
): boolean {
  const needs = world.tryGet(e, SettlerNeeds);
  return (
    needs !== undefined &&
    needLevel(needs, 'fatigue', ctx.tick) >= NEED_CRITICAL_THRESHOLD &&
    !world.has(e, NoRegeneration) &&
    carriesNeeds(world, ctx.content, e) &&
    !onAlert(e)
  );
}

function standingNode(world: World, terrain: TerrainGraph, e: Entity): NodeId {
  const p = world.get(e, Position);
  const hn = nodeOfPosition(p.x, p.y);
  return terrain.nodeAtClamped(hn.hx, hn.hy);
}

/** The unseen patches of `ground` in `player`'s raw mask, or null when fog hides nothing. */
function unseenPatchesOf(
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  ground: number,
): UnseenPatches | null {
  const fog = ctx.fog;
  if (fog === undefined || fog.activeMode === FOG_MODE.OFF) return null;
  // A group that never saw anything has no mask yet: every cell is unexplored.
  return new UnseenPatches(terrain, fog.tryMaskFor(player) ?? null, fog.cellsWide, fog.cellsHigh, ground);
}

/** Which unseen fog cells sit in a patch of unseen land big enough to walk to. */
class UnseenPatches {
  constructor(
    private readonly terrain: TerrainGraph,
    private readonly mask: Uint8Array | null,
    readonly cellsWide: number,
    readonly cellsHigh: number,
    readonly ground: number,
  ) {}

  isUnseen(cx: number, cy: number): boolean {
    return this.mask === null || this.mask[cy * this.cellsWide + cx] === FOG_STATE.UNEXPLORED;
  }

  /** Whether unseen cell (cx, cy) has {@link PATCH_MIN_UNSEEN_LAND} unseen land cells around it. */
  worthVisiting(cx: number, cy: number): boolean {
    if (!this.isUnseen(cx, cy)) return false;
    let land = 0;
    const top = Math.max(0, cy - PATCH_RADIUS_CELLS);
    const bottom = Math.min(this.cellsHigh - 1, cy + PATCH_RADIUS_CELLS);
    const left = Math.max(0, cx - PATCH_RADIUS_CELLS);
    const right = Math.min(this.cellsWide - 1, cx + PATCH_RADIUS_CELLS);
    for (let row = top; row <= bottom; row++) {
      for (let col = left; col <= right; col++) {
        if (this.isUnseen(col, row) && this.isLand(col, row) && ++land >= PATCH_MIN_UNSEEN_LAND) return true;
      }
    }
    return false;
  }

  /** Whether fog cell (cx, cy) holds a walkable node of the landmass. */
  private isLand(cx: number, cy: number): boolean {
    const { terrain } = this;
    for (let y = cy * 2; y <= cy * 2 + 1 && y < terrain.height; y++) {
      for (let x = cx * 2; x <= cx * 2 + 1 && x < terrain.width; x++) {
        const node = terrain.nodeAt(x, y);
        if (
          terrain.isWalkable(node) &&
          (this.ground === NO_COMPONENT || terrain.componentOf(node) === this.ground)
        )
          return true;
      }
    }
    return false;
  }
}

/**
 * The next goal of a sweep from `from`: among the walkable nodes of unseen cells on the scout's static
 * ground that sit in a patch worth the walk ({@link PATCH_MIN_UNSEEN_LAND}), off the live walk-block layer (trees, rocks, buildings) and clear of the goals the sweep found it
 * cannot reach, those in the band of {@link SPIRAL_BAND_RINGS} fog-cell rings from the first ring around
 * the origin that holds one, and of them the nearest to the scout, ties on the lower node id. `ring` is
 * that first ring. Null when the landmass holds no such ground, which is also what an off fog mode reads,
 * since then nothing is hidden.
 *
 * Seen ground only grows, so the search starts at the order's `frontierRing`; finding nothing from there
 * it searches once more from the origin, since a felled tree or a forgotten unreachable goal can open a
 * nearer node. A search costs a byte read per seen cell and up to four node reads per unseen one of the
 * rings it passes, the landmass's box at worst; the patch count runs only for a node that would be picked.
 */
function spiralPick(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  player: number,
  order: ExploreSweep,
  from: NodeId,
): { readonly node: NodeId; readonly ring: number } | null {
  const patches = unseenPatchesOf(ctx, terrain, player, terrain.componentOf(from));
  if (patches === null) return null;
  const scout = terrain.coordsOf(from);
  const pick = new UnexploredPick(
    terrain,
    patches,
    dynamicBlockOverlay(world, ctx, terrain),
    scout.x,
    scout.y,
    order.unreachable,
  );
  const o = terrain.coordsOf(order.origin);
  const centre = cellOfNode(o.x, o.y);
  const rings = new FogRings(patches, terrain, centre.cx, centre.cy);
  for (const start of order.frontierRing > 0 ? [order.frontierRing, 0] : [0]) {
    let first = -1;
    for (let r = start; r <= rings.maxRing && (first < 0 || r <= first + SPIRAL_BAND_RINGS); r++) {
      rings.offerUnexplored(r, pick);
      if (first < 0 && pick.best !== null) first = r;
    }
    if (pick.best !== null) return { node: pick.best, ring: first };
  }
  return null;
}

/** Square rings of fog cells around a centre cell, clipped to the fog cells the landmass spans. */
class FogRings {
  readonly maxRing: number;
  private readonly left: number;
  private readonly top: number;
  private readonly right: number;
  private readonly bottom: number;

  constructor(
    private readonly patches: UnseenPatches,
    terrain: TerrainGraph,
    private readonly cx: number,
    private readonly cy: number,
  ) {
    const { ground } = patches;
    if (ground === NO_COMPONENT) {
      [this.left, this.top] = [0, 0];
      [this.right, this.bottom] = [patches.cellsWide - 1, patches.cellsHigh - 1];
    } else {
      const box = terrain.componentBounds(ground);
      const min = cellOfNode(box.minX, box.minY);
      const max = cellOfNode(box.maxX, box.maxY);
      [this.left, this.top, this.right, this.bottom] = [min.cx, min.cy, max.cx, max.cy];
    }
    this.maxRing = Math.max(cx - this.left, this.right - cx, cy - this.top, this.bottom - cy);
  }

  /** Offer every unexplored cell of ring `r` to `pick`; an explored cell costs one byte read. */
  offerUnexplored(r: number, pick: UnexploredPick): void {
    const { cx, cy, patches } = this;
    const left = Math.max(this.left, cx - r);
    const right = Math.min(this.right, cx + r);
    for (const row of r === 0 ? [cy] : [cy - r, cy + r]) {
      if (row < this.top || row > this.bottom) continue;
      for (let c = left; c <= right; c++) {
        if (patches.isUnseen(c, row)) pick.considerCell(c, row);
      }
    }
    if (r === 0) return;
    const top = Math.max(this.top, cy - r + 1);
    const bottom = Math.min(this.bottom, cy + r - 1);
    for (const col of [cx - r, cx + r]) {
      if (col < this.left || col > this.right) continue;
      for (let row = top; row <= bottom; row++) {
        if (patches.isUnseen(col, row)) pick.considerCell(col, row);
      }
    }
  }
}

/** The running choice of {@link spiralPick}: the offered node nearest the scout. */
class UnexploredPick {
  best: NodeId | null = null;
  private bestDist = Number.POSITIVE_INFINITY;
  private readonly avoided: readonly { readonly x: number; readonly y: number }[];

  constructor(
    private readonly terrain: TerrainGraph,
    private readonly patches: UnseenPatches,
    private readonly blocked: BlockOverlay,
    private readonly ax: number,
    private readonly ay: number,
    unreachable: readonly NodeId[],
  ) {
    this.avoided = unreachable.map((n) => terrain.coordsOf(n));
  }

  /** Offer the nodes of unseen fog cell (cx, cy) - those `cellOfNode` maps to it - that a leg may aim at,
   *  when the cell is worth the walk. The patch count runs last, only for a node that would win: unseen sea,
   *  other islands and far land cost four node reads a cell. */
  considerCell(cx: number, cy: number): void {
    const { terrain } = this;
    const { ground } = this.patches;
    let worth: boolean | undefined;
    for (let y = cy * 2; y <= cy * 2 + 1 && y < terrain.height; y++) {
      for (let x = cx * 2; x <= cx * 2 + 1 && x < terrain.width; x++) {
        const node = terrain.nodeAt(x, y);
        if (!terrain.isWalkable(node) || this.blocked.has(node)) continue;
        if (ground !== NO_COMPONENT && terrain.componentOf(node) !== ground) continue;
        const dist = (x - this.ax) ** 2 + (y - this.ay) ** 2;
        const wins =
          dist < this.bestDist || (dist === this.bestDist && this.best !== null && node < this.best);
        if (!wins || this.isAvoided(x, y)) continue;
        worth ??= this.patches.worthVisiting(cx, cy);
        if (!worth) return;
        this.best = node;
        this.bestDist = dist;
      }
    }
  }

  private isAvoided(x: number, y: number): boolean {
    return this.avoided.some(
      (u) =>
        Math.abs(u.x - x) <= UNREACHABLE_CLEARANCE_NODES && Math.abs(u.y - y) <= UNREACHABLE_CLEARANCE_NODES,
    );
  }
}
