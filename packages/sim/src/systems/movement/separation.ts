import {
  Building,
  Obstructed,
  Owner,
  PathFollow,
  PathRequest,
  Position,
  Settler,
} from '../../components/index.js';
import { type Fixed, ZERO, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition, positionXOfWorld } from '../../nav/halfcell.js';
import { ROW_STEP, worldDistance, worldX } from '../../nav/metric.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain.js';
import type { System } from '../context.js';
import { dynamicBlockedCells } from '../footprint/index.js';
import { isFighterJob } from '../readviews/index.js';
import { NodeBuckets, canonicalById, clearNavState } from '../spatial.js';
import { MOVE_SPEED_PER_TICK } from './movement.js';

/**
 * UNIT BODY COLLISION — a NAMED DEVIATION from the original, which has none (walkers pass through
 * each other freely; OpenVikings carries no unit-vs-unit collision state and none is observable in
 * play). Added deliberately for RTS depth, on the user's design decision: a standing line of
 * fighters must physically hold a chokepoint, a charge must fan out around its target instead of
 * stacking a tile, and the economy must keep the original's frictionless flow. The model is the
 * modern-RTS split (StarCraft 2's): collision is LOCAL resolution only — pathfinding never waits on
 * a moving body — with standing units alone entering the walk overlay.
 *
 * Three-role model, decided per entity per tick:
 *  - **Movers** (a collider currently walking a {@link PathFollow}) are the only bodies ever
 *    displaced. Mover-vs-mover overlap resolves softly (half the overlap each, capped at
 *    {@link SEPARATION_PUSH_CAP}); mover-vs-post resolves fully (the mover is placed back on the
 *    post's radius), so a post is impenetrable but never jitters.
 *  - **Posts** (a collider standing still) are immovable, and the routing layer stamps their nodes
 *    into the walk-block overlay (`unitWalkBlocks`) so fresh routes go AROUND a standing line
 *    instead of grinding on it. A walker that still ends up pushing against bodies (a stale route,
 *    a sealed wall) counts {@link Obstructed} ticks and abandons its route at the give-up threshold.
 *  - **Ghosts** — everyone else. Only OWNED FIGHTERS collide ({@link isFighterJob}): civilians keep
 *    the original's pass-through everywhere, so economy flows that legally converge on one node (a
 *    shared work cell, a store door) can never jam; unowned entities keep every fixture and golden
 *    byte-identical (the same Owner gate the idle-spacing drive uses). A mover inside its own
 *    player's {@link calmZone} is also a ghost — fighters queueing at their own stores/houses never
 *    wedge on each other in a dense town.
 *
 * Determinism: movers are processed in ascending entity id; mover-vs-mover pushes read the tick's
 * pre-separation position snapshot (order-independent by construction); mover-vs-post resolutions
 * apply in ascending post id; every quantity is fixed-point via `fx.*`. Scale: per-tick cost is
 * O(colliders) to bucket plus O(movers × local crowd) to resolve — a sim with no walking fighter
 * pays only the bucket scan, and a mapless sim (the determinism golden) exits immediately.
 */

/**
 * A collider's body radius, in world-metric column units. The bounds are the half-cell lattice's own
 * pitches, and both matter:
 *  - **> half the E/W node pitch (0.25)** — posts standing on horizontally adjacent nodes leave no
 *    zero-width slip line between their radii, so a one-per-node line is a closed wall;
 *  - **< the N/S node pitch (19/68 ≈ 0.2794)** — a post never covers a neighbouring node's CENTRE,
 *    so any free node stays exactly reachable (arrival is an exact position match) and a melee
 *    attacker on an adjacent node stands clear of its target's body.
 * Impassability holds because a mover advances at most its gait + {@link SEPARATION_PUSH_CAP}
 * (≈ 0.19 at the fleeing run pace) per tick — always less than this radius, so it can never step
 * from outside a post's radius past the post's centre in one tick, and the full resolve returns it
 * to the near side every time.
 */
export const UNIT_SEPARATION_RADIUS: Fixed = fx.div(fx.fromInt(13), fx.fromInt(50));

/**
 * The per-tick cap on the SOFT mover-vs-mover push, deliberately below the arrival brake floor
 * (`gait / ARRIVAL_SPEED_DIV`, see `movement.ts`): a walker being brushed by passing traffic still
 * makes net progress every tick, so soft separation can delay an arrival but never prevent one.
 * Tuned to ⅖ of the gait (just under the ½ floor): the first ¼ cut let a charging mass overlap
 * deeply mid-march — a converging army read as one pile of sprites (the feel note that raised it).
 */
export const SEPARATION_PUSH_CAP: Fixed = fx.div(fx.mul(MOVE_SPEED_PER_TICK, fx.fromInt(2)), fx.fromInt(5));

/**
 * The Manhattan node radius of a player's CALM ZONE around each of its buildings — the user's
 * "collision off near the settlement" rule. Inside its own player's zone a mover is a ghost (it
 * neither pushes nor is pushed) and a post is not stamped into that player's own walk overlay, so a
 * player's town traffic keeps the original's frictionless flow; enemies get no exemption from
 * someone else's town. Sized to cover a building's footprint plus its door approaches (~4 columns).
 * A feel-tuning constant — no original counterpart (the original has no collision at all).
 */
export const CALM_ZONE_RADIUS_NODES = 8;

/**
 * Consecutive {@link Obstructed} ticks (bodies resolved AGAINST the walker's heading) before the
 * walker abandons its route — ~1.2 s at 20 Hz: long enough to shoulder through a brush-past, short
 * enough that grinding on a shield wall reads as "blocked, stops" rather than a stuck unit. The
 * goal's owner (combat chase, player order, AI drive) re-issues on its own cadence and the re-route
 * sees the blockers in the walk overlay.
 */
export const OBSTRUCTED_GIVE_UP_TICKS = 24;

/** How far (in nodes) the walk-overlay goal fallback searches for a free stand-in node around a
 *  unit-occupied goal — enough to ring several bodies deep around a crowded target before giving up. */
export const GOAL_FALLBACK_SEARCH_CAP = 64;

/**
 * Whether `e` takes part in body collision at all: an OWNED FIGHTER (see the file header — civilians
 * and unowned entities keep the original's pass-through). Shared with the routing layer, which
 * applies the standing-body walk overlay only to a requester that itself collides: a ghost walks
 * straight through bodies, so detouring it (or re-aiming its goal off an occupied node — an economy
 * walk's target must stay EXACT for the node-coincidence checks) would be wrong both ways.
 */
export function hasBodyCollision(world: World, e: Entity): boolean {
  if (!world.has(e, Owner)) return false;
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && isFighterJob(settler.jobType);
}

/** Whether `e` is STANDING for collision purposes: not walking a path and not waiting on a live
 *  route (a pending request means it is about to move — treating it as a body would stamp a node it
 *  is leaving). A FAILED request is standing: nothing will move it until its goal's owner reacts. */
function isStanding(world: World, e: Entity): boolean {
  if (world.has(e, PathFollow)) return false;
  const req = world.tryGet(e, PathRequest);
  return req === undefined || req.failed;
}

/**
 * Every player's calm-zone node set: a Manhattan diamond of {@link CALM_ZONE_RADIUS_NODES} around
 * each of its buildings' anchor nodes. Derived per tick, membership-only (set unions — iteration
 * order can't change any answer), never hashed.
 */
export function calmZonesByPlayer(world: World, terrain: TerrainGraph): Map<number, Set<NodeId>> {
  const zones = new Map<number, Set<NodeId>>();
  for (const b of world.query(Building, Position)) {
    const owner = world.tryGet(b, Owner);
    if (owner === undefined) continue;
    let zone = zones.get(owner.player);
    if (zone === undefined) {
      zone = new Set();
      zones.set(owner.player, zone);
    }
    const p = world.get(b, Position);
    const { hx, hy } = nodeOfPosition(p.x, p.y);
    for (let dx = -CALM_ZONE_RADIUS_NODES; dx <= CALM_ZONE_RADIUS_NODES; dx++) {
      const rem = CALM_ZONE_RADIUS_NODES - Math.abs(dx);
      for (let dy = -rem; dy <= rem; dy++) {
        if (terrain.inBounds(hx + dx, hy + dy)) zone.add(terrain.nodeAt(hx + dx, hy + dy));
      }
    }
  }
  return zones;
}

/**
 * The nodes standing colliders (posts) block for ROUTING, split by who is asking:
 *  - `field` — posts outside their own player's calm zone: blocked for EVERY requester (a wall in
 *    the field detours friend and foe alike — routing matches the physics, which is firm for both);
 *  - `townByPlayer` — player → nodes of that player's posts INSIDE its own calm zone: blocked only
 *    for OTHER players' requesters. The owner's own traffic routes straight through its town (its
 *    movers there are ghosts anyway), while an enemy is steered around the garrison instead of
 *    grinding on it.
 * Derived per routing tick, membership-only, never hashed (the `NodeBuckets` stance).
 */
export interface UnitWalkBlocks {
  readonly field: ReadonlySet<NodeId>;
  readonly townByPlayer: ReadonlyMap<number, ReadonlySet<NodeId>>;
}

/** Visit every standing collider (post) with its clamped node and owning player — the one scan both
 *  walk-overlay stampers and the combat slot filter derive their standing-body sets from. */
function eachStandingFighter(
  world: World,
  terrain: TerrainGraph,
  visit: (e: Entity, node: NodeId, player: number) => void,
): void {
  for (const e of world.query(Settler, Position)) {
    if (!hasBodyCollision(world, e) || !isStanding(world, e)) continue;
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    if (!terrain.inBounds(n.hx, n.hy)) continue;
    visit(e, terrain.nodeAt(n.hx, n.hy), world.get(e, Owner).player);
  }
}

/**
 * The nodes standing colliders occupy, regardless of calm zones — the CombatSystem's melee-slot
 * filter (an approach cell someone already stands on is a taken slot even inside a town garrison).
 * Derived per tick, membership-only, never hashed.
 */
export function standingFighterNodes(world: World, terrain: TerrainGraph): ReadonlySet<NodeId> {
  const nodes = new Set<NodeId>();
  eachStandingFighter(world, terrain, (_e, node) => nodes.add(node));
  return nodes;
}

export function unitWalkBlocks(world: World, terrain: TerrainGraph): UnitWalkBlocks {
  const zones = calmZonesByPlayer(world, terrain);
  const field = new Set<NodeId>();
  const townByPlayer = new Map<number, Set<NodeId>>();
  eachStandingFighter(world, terrain, (_e, node, player) => {
    if (zones.get(player)?.has(node)) {
      let town = townByPlayer.get(player);
      if (town === undefined) {
        town = new Set();
        townByPlayer.set(player, town);
      }
      town.add(node);
    } else {
      field.add(node);
    }
  });
  return { field, townByPlayer };
}

/** A point in the lattice's WORLD axes (columns across, rows·ROW_STEP down — the `worldDistance`
 *  frame), where separation geometry is computed so every direction is priced by on-screen length. */
interface WorldPoint {
  x: Fixed;
  y: Fixed;
}

function toWorld(x: Fixed, y: Fixed): WorldPoint {
  return { x: worldX(x, y), y: fx.mul(y, ROW_STEP) };
}

/** The inverse of {@link toWorld}: a world-axis point back to Position grid coords. Truncates ≤ a
 *  couple of ulps — bounded, not accumulating (a walker re-snaps exactly onto every waypoint). */
function toGrid(w: WorldPoint): { x: Fixed; y: Fixed } {
  const y = fx.div(w.y, ROW_STEP);
  return { x: positionXOfWorld(w.x, y), y };
}

/**
 * SeparationSystem — runs right after the MovementSystem and resolves this tick's body overlaps
 * among colliders (see the file header for the model and its source basis). Displaces MOVERS only;
 * a displaced position must land on walkable, unblocked ground or the offending axis (then the whole
 * displacement) is discarded, so collision can never push a body into water or through a wall.
 */
export const separationSystem: System = (world, ctx) => {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no lattice to collide on

  // Colliders currently walking — the only entities this system ever displaces.
  const movers: Entity[] = [];
  for (const e of world.query(PathFollow, Position)) {
    if (hasBodyCollision(world, e)) movers.push(e);
  }
  // An Obstructed counter survives only on a walker: arrival/give-up/re-tasking ends the grind.
  for (const e of canonicalById(world.query(Obstructed))) {
    if (!world.has(e, PathFollow)) world.remove(e, Obstructed);
  }
  if (movers.length === 0) return; // dormancy: nobody walking → nothing can overlap anything
  movers.sort((a, b) => a - b);

  // Standing colliders — the immovable posts movers resolve against.
  const posts: Entity[] = [];
  for (const e of world.query(Settler, Position)) {
    if (hasBodyCollision(world, e) && isStanding(world, e)) posts.push(e);
  }
  const postIndex = new NodeBuckets(world, canonicalById(posts));
  const moverIndex = new NodeBuckets(world, movers);

  // The tick's pre-separation mover positions: soft pushes read THIS snapshot, so a pair's two
  // halves are computed from the same state regardless of processing order.
  const before = new Map<Entity, { x: Fixed; y: Fixed }>();
  for (const e of movers) {
    const p = world.get(e, Position);
    before.set(e, { x: p.x, y: p.y });
  }

  // Lazy shared per-tick state: zones/overlay are built only if some pair actually interacts.
  let zones: Map<number, Set<NodeId>> | undefined;
  const ghostMemo = new Map<Entity, boolean>();
  const isGhostMover = (e: Entity): boolean => {
    let ghost = ghostMemo.get(e);
    if (ghost === undefined) {
      zones ??= calmZonesByPlayer(world, terrain);
      const p = world.get(e, Position);
      const n = nodeOfPosition(p.x, p.y);
      ghost =
        terrain.inBounds(n.hx, n.hy) &&
        (zones.get(world.get(e, Owner).player)?.has(terrain.nodeAt(n.hx, n.hy)) ?? false);
      ghostMemo.set(e, ghost);
    }
    return ghost;
  };
  let blockedOverlay: ReadonlySet<NodeId> | undefined;
  const safeLanding = (x: Fixed, y: Fixed): boolean => {
    const n = nodeOfPosition(x, y);
    if (!terrain.inBounds(n.hx, n.hy)) return false;
    const node = terrain.nodeAt(n.hx, n.hy);
    if (!terrain.isWalkable(node)) return false;
    blockedOverlay ??= dynamicBlockedCells(world, ctx, terrain);
    return !blockedOverlay.has(node);
  };

  for (const e of movers) {
    const start = before.get(e);
    if (start === undefined) continue; // movers ⊆ before by construction; guard for the checked access
    const node = nodeOfPosition(start.x, start.y);

    // Gather this mover's neighbourhood. Radius < both bucket pitches, so bodies within reach live
    // in the 3×3 bucket block around the mover's own node (truncation adds at most one node).
    const nearMovers: Entity[] = [];
    const nearPosts: Entity[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const n of moverIndex.at(node.hx + dx, node.hy + dy)) {
          if (n !== e) nearMovers.push(n);
        }
        nearPosts.push(...postIndex.at(node.hx + dx, node.hy + dy));
      }
    }
    if (nearMovers.length === 0 && nearPosts.length === 0) {
      world.remove(e, Obstructed);
      continue;
    }
    if (isGhostMover(e)) {
      world.remove(e, Obstructed);
      continue; // in its own town: full pass-through, both ways
    }

    // SOFT half: accumulate the push away from every overlapping fellow mover (half the overlap
    // each — the other half is the neighbour's own pass), then cap the total.
    const startW = toWorld(start.x, start.y);
    let pushX = ZERO;
    let pushY = ZERO;
    for (const n of nearMovers) {
      if (isGhostMover(n)) continue;
      const other = before.get(n);
      if (other === undefined) continue;
      const dist = worldDistance(start.x, start.y, other.x, other.y);
      if (dist >= UNIT_SEPARATION_RADIUS) continue;
      const half = fx.div(fx.sub(UNIT_SEPARATION_RADIUS, dist), fx.fromInt(2));
      if (dist === ZERO) {
        // Exactly stacked: split along E/W by id order — a named pick, not iteration luck.
        pushX = fx.add(pushX, e < n ? fx.sub(ZERO, half) : half);
      } else {
        const otherW = toWorld(other.x, other.y);
        pushX = fx.add(pushX, fx.mulDiv(fx.sub(startW.x, otherW.x), half, dist));
        pushY = fx.add(pushY, fx.mulDiv(fx.sub(startW.y, otherW.y), half, dist));
      }
    }
    if (pushX !== ZERO || pushY !== ZERO) {
      const mag = fx.isqrt(fx.add(fx.mul(pushX, pushX), fx.mul(pushY, pushY)));
      if (mag > SEPARATION_PUSH_CAP) {
        pushX = fx.mulDiv(pushX, SEPARATION_PUSH_CAP, mag);
        pushY = fx.mulDiv(pushY, SEPARATION_PUSH_CAP, mag);
      }
    }

    const p = world.get(e, Position);
    let cand = { x: p.x, y: p.y };
    if (pushX !== ZERO || pushY !== ZERO) {
      const candW = toWorld(p.x, p.y);
      cand = toGrid({ x: fx.add(candW.x, pushX), y: fx.add(candW.y, pushY) });
    }

    // HARD half: place the mover back on each overlapped post's radius, ascending post id. A post
    // resolved AGAINST the walker's heading is a body in the way — that is what feeds the give-up
    // counter (a sideways brush while sliding around a lone post does not).
    let opposed = false;
    const pf = world.get(e, PathFollow);
    const waypoint = pf.waypoints[pf.index];
    for (const s of nearPosts) {
      const sp = world.get(s, Position);
      const dist = worldDistance(cand.x, cand.y, sp.x, sp.y);
      if (dist >= UNIT_SEPARATION_RADIUS) continue;
      const postW = toWorld(sp.x, sp.y);
      const candW = toWorld(cand.x, cand.y);
      let outX: Fixed;
      let outY: Fixed;
      if (dist === ZERO) {
        // Exactly on the post: eject east/west by id order (a named pick).
        outX = e < s ? fx.sub(ZERO, UNIT_SEPARATION_RADIUS) : UNIT_SEPARATION_RADIUS;
        outY = ZERO;
      } else {
        outX = fx.mulDiv(fx.sub(candW.x, postW.x), UNIT_SEPARATION_RADIUS, dist);
        outY = fx.mulDiv(fx.sub(candW.y, postW.y), UNIT_SEPARATION_RADIUS, dist);
      }
      const resolvedW = { x: fx.add(postW.x, outX), y: fx.add(postW.y, outY) };
      if (waypoint !== undefined) {
        const headX = fx.sub(worldX(waypoint.x, waypoint.y), candW.x);
        const headY = fx.sub(fx.mul(waypoint.y, ROW_STEP), candW.y);
        const moveX = fx.sub(resolvedW.x, candW.x);
        const moveY = fx.sub(resolvedW.y, candW.y);
        if (fx.add(fx.mul(moveX, headX), fx.mul(moveY, headY)) < ZERO) opposed = true;
      }
      cand = toGrid(resolvedW);
    }

    // Landing safety: never displace onto unwalkable/blocked ground — drop the offending axis, then
    // the whole displacement (the walker's own path point is always a legal stand).
    if (cand.x !== p.x || cand.y !== p.y) {
      if (safeLanding(cand.x, cand.y)) {
        p.x = cand.x;
        p.y = cand.y;
      } else if (safeLanding(cand.x, p.y)) {
        p.x = cand.x;
      } else if (safeLanding(p.x, cand.y)) {
        p.y = cand.y;
      }
    }

    // Give-up bookkeeping: only a push AGAINST the heading counts; any clear tick resets.
    if (opposed) {
      const ticks = (world.tryGet(e, Obstructed)?.ticks ?? 0) + 1;
      if (ticks >= OBSTRUCTED_GIVE_UP_TICKS) {
        clearNavState(world, e); // stand down where it is; the goal's owner re-issues on its cadence
        world.remove(e, Obstructed);
      } else {
        world.add(e, Obstructed, { ticks });
      }
    } else {
      world.remove(e, Obstructed);
    }
  }
};
