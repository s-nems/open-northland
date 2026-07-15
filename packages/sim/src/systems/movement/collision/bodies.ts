import { Building, Owner, PathFollow, PathRequest, Position, Settler } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import { nodeOfPosition } from '../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import { isFighterJob } from '../../readviews/index.js';

/**
 * Unit body collision — a named deviation from the original, where walkers are observed passing through
 * each other. Added
 * deliberately for RTS depth, on the user's design decision: a standing line of fighters must physically hold
 * a chokepoint, a charge must fan out around its target instead of stacking a tile, and the economy must keep
 * the original's frictionless flow. The model is the modern-RTS split: collision is local resolution only —
 * pathfinding never waits on a moving body — with standing units alone entering the walk overlay.
 *
 * This module is the who/where read-model shared by the three consumers (the SeparationSystem's physical
 * resolve, the routing layer's walk overlay, the CombatSystem's melee-slot filter). Two tiers:
 *  - Soft movers ({@link hasSoftCollision} — any owned settler walking a {@link PathFollow}, civilians
 *    included) nudge each other apart while walking, everywhere. The nudge is capped below the arrival brake
 *    floor (see separation.ts), so it can delay an arrival but never prevent one — walkers just stop drawing
 *    as one merged sprite. They never block routing and never resolve against posts.
 *  - Firm movers ({@link hasBodyCollision} — owned fighters walking) additionally resolve hard against posts
 *    and carry the obstruction grind window (the re-route/give-up machinery).
 *  - Posts (a firm collider standing still) are immovable, and {@link unitWalkBlocks} stamps their nodes into
 *    the walk-block overlay so fresh routes go around a standing line instead of grinding on it.
 *  - Ghosts — everyone else. Civilians keep the original's pass-through against every standing body, so
 *    economy flows that legally converge on one node can never jam; unowned entities keep every fixture and
 *    golden byte-identical. A firm mover inside its own player's calm zone ({@link calmZonesByPlayer}) drops
 *    to the soft tier — fighters queueing at their own stores/houses never wedge on each other in a dense town.
 */

/**
 * The Manhattan node radius of a player's calm zone around each of its buildings — the user's "collision off
 * near the settlement" rule, scoped to the firm tier: inside its own player's zone a firm mover skips the hard
 * post resolve and the obstruction grind, and a post is not stamped into that player's own walk overlay, so a
 * player's town traffic keeps the original's frictionless flow; enemies get no exemption from someone else's
 * town. The soft mover-vs-mover nudge stays on in town — it cannot jam anything (capped below the arrival
 * brake floor) and is what keeps a busy street reading as individuals. Sized to cover a building's footprint
 * plus its door approaches (~4 columns). A feel-tuning constant with no original counterpart.
 */
export const CALM_ZONE_RADIUS_NODES = 8;

/**
 * Whether `e` takes part in firm body collision: an owned fighter (see the module header — civilians and
 * unowned entities keep the original's pass-through against standing bodies). Shared with the routing layer,
 * which applies the standing-body walk overlay only to a requester that itself firmly collides: a ghost walks
 * straight through bodies, so detouring it (or re-aiming its goal off an occupied node — an economy walk's
 * target must stay exact for the node-coincidence checks) would be wrong both ways.
 */
export function hasBodyCollision(world: World, e: Entity): boolean {
  if (!world.has(e, Owner)) return false;
  const settler = world.tryGet(e, Settler);
  return settler !== undefined && isFighterJob(settler.jobType);
}

/**
 * Whether `e` takes part in soft mover-vs-mover separation: any owned settler (fighters and civilians alike —
 * the "walking units never merge" tier of the module header). The Owner gate keeps unowned fixtures and
 * goldens byte-identical, like {@link hasBodyCollision} and the idle-spacing drive.
 */
export function hasSoftCollision(world: World, e: Entity): boolean {
  return world.has(e, Owner) && world.has(e, Settler);
}

/** Whether `e` is standing for collision purposes: not walking a path and not waiting on a live route (a
 *  pending request means it is about to move — treating it as a body would stamp a node it is leaving). A
 *  failed request is standing: nothing will move it until its goal's owner reacts. */
export function isStanding(world: World, e: Entity): boolean {
  if (world.has(e, PathFollow)) return false;
  const req = world.tryGet(e, PathRequest);
  return req === undefined || req.failed;
}

/**
 * Per-(world, tick) memo of {@link calmZonesByPlayer}: the zones are consumed by both the routing tick (via
 * {@link unitWalkBlocks}) and the SeparationSystem in the same tick, and the inputs — buildings, their owners
 * and positions — cannot change between those two systems (only movement and separation run in between, and
 * they touch settlers alone), so one derivation serves both. Keyed by the World object (a WeakMap — two sims
 * in one test process can never share an entry) and guarded by the exact tick; re-derived each tick, so no
 * `World.verifyCaches` registration is owed.
 */
const zonesMemo = new WeakMap<World, { tick: number; zones: Map<number, Set<NodeId>> }>();

/**
 * Every player's calm-zone node set: a Manhattan diamond of {@link CALM_ZONE_RADIUS_NODES} around
 * each of its buildings' anchor nodes. Derived per tick (memoized — see {@link zonesMemo}),
 * membership-only (set unions — iteration order can't change any answer), never hashed.
 */
export function calmZonesByPlayer(
  world: World,
  terrain: TerrainGraph,
  tick: number,
): Map<number, Set<NodeId>> {
  const hit = zonesMemo.get(world);
  if (hit !== undefined && hit.tick === tick) return hit.zones;
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
  zonesMemo.set(world, { tick, zones });
  return zones;
}

/**
 * The nodes standing colliders (posts) block for routing, split by who is asking:
 *  - `field` — posts outside their own player's calm zone: blocked for every collider requester (a wall in
 *    the field detours friend and foe alike);
 *  - `townByPlayer` — player → nodes of that player's posts inside its own calm zone: blocked only for other
 *    players' requesters. The owner's own traffic routes straight through its town (its movers there are
 *    ghosts anyway), while an enemy is steered around the garrison instead of grinding on it.
 * Derived per routing tick, membership-only, never hashed.
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
 * The nodes standing colliders occupy, regardless of calm zones — the CombatSystem's melee-slot filter (an
 * approach cell someone already stands on is a taken slot even inside a town garrison). Derived per tick,
 * membership-only, never hashed.
 */
export function standingFighterNodes(world: World, terrain: TerrainGraph): ReadonlySet<NodeId> {
  const nodes = new Set<NodeId>();
  eachStandingFighter(world, terrain, (_e, node) => nodes.add(node));
  return nodes;
}

export function unitWalkBlocks(world: World, terrain: TerrainGraph, tick: number): UnitWalkBlocks {
  const zones = calmZonesByPlayer(world, terrain, tick);
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
