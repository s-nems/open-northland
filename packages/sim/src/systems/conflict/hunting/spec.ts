import { HuntFocus, Settler } from '../../../components/index.js';
import { ownerOf, ownersCompatible } from '../../../components/ownership.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { isLastResortPrey } from '../../readviews/index.js';
import { manhattan } from '../../spatial/metric.js';
import { entityNode } from '../../spatial/nodes.js';
import type { CombatIndex } from '../combat-index.js';
import type { EngageSpec } from '../engagement.js';
import { isHuntTarget } from '../targeting.js';
import { HUNT_CHASE_SLACK_NODES, HUNT_LAST_RESORT_SCAN_FACTOR, huntingGround } from './ground.js';
import { huntingGroundHoldsCarcass } from './kill-claim.js';

// The prey-acquisition policy an owned IGNORE hunter engages under.

/**
 * The hunter's target-acquisition spec, and the owner of the one-kill-at-a-time rule (authored): while the
 * ground holds a harvestable carcass the hunter takes no new target. It accepts only huntable prey inside
 * its hunting ground, which anchors the chase leash but is never held - an idle hunter belongs to its
 * flag-gatherer drive. A hunter with neither flag nor workplace hunts by plain sight, unanchored.
 *
 * Last-resort livestock (huntPrey `lastResort`) is fenced off twice: `lowPriority` keeps normal game in the
 * ground ahead of it, and {@link lastResortGate} refuses it outright while real game stands in the wider
 * probe. Only acquisition is gated - an animal already drawn on is still run down.
 *
 * The `lock` holds the animal the hunter drew on out to the chase leash rather than the tighter acquisition
 * radius: prey bolts on the first arrow, so expiring at the acquisition line would restore the very swap
 * the lock prevents. Building the spec mutates - a lock the rules no longer admit is reaped as it is read.
 */
export function hunterEngageSpec(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  e: Entity,
  hereNode: NodeId,
  jobType: number | null,
  seesTarget: (t: Entity) => boolean,
  givenUp: ((t: Entity) => boolean) | undefined,
  minDist: number,
  sight: number,
): EngageSpec {
  const hunterComponent = terrain.componentOf(hereNode);
  // Lazily resolved on the first candidate: a hunter that never reaches one pays nothing for the set.
  let colleagueHolds: ReadonlySet<Entity> | null = null;
  const heldByColleague = (t: Entity): boolean => {
    colleagueHolds ??= preyHeldByOthers(world, e);
    return colleagueHolds.has(t);
  };
  // An animal across a static terrain seam is not this hunter's game, and deliberately with none of the
  // in-reach tolerance the general acquisition gate allows a soldier: a hunter wants the meat, and a kill it
  // cannot walk to is a carcass no hunter may ever bank.
  const reachablePrey = (t: Entity): boolean =>
    isHuntTarget(world, ctx, t, jobType) &&
    terrain.componentOf(entityNode(world, terrain, t)) === hunterComponent;
  const acceptPrey = (t: Entity): boolean =>
    reachablePrey(t) && !heldByColleague(t) && seesTarget(t) && (givenUp === undefined || !givenUp(t));
  const lastResortLivestock = (t: Entity): boolean => {
    const s = world.tryGet(t, Settler);
    return s !== undefined && isLastResortPrey(ctx.content, s.tribe);
  };
  // `player` is null in every hunter spec: a hunter is never presence-gated, in any stance.
  const ground = huntingGround(world, terrain, e);
  if (ground === null) {
    // Unanchored (an unposted fixture): plain sight bounds the acquisition, so it bounds the hold too.
    const inSight = (t: Entity): boolean =>
      manhattan(terrain, hereNode, entityNode(world, terrain, t)) <= sight;
    const lastResortOk = lastResortGate(terrain, index, hereNode, sight, reachablePrey, lastResortLivestock);
    return {
      accept: (t) => acceptPrey(t) && lastResortOk(t),
      minDist,
      searchRadius: sight,
      player: null,
      lowPriority: lastResortLivestock,
      lock: { target: livePrey(world, e, (t) => acceptPrey(t) && inSight(t)) },
      defend: null,
    };
  }
  // Probed at most once per engage, on the first candidate to reach it.
  let carcassWork: boolean | null = null;
  const groundHasCarcassWork = (): boolean =>
    (carcassWork ??= huntingGroundHoldsCarcass(world, ctx, terrain, e, jobType, ground));
  const within = (t: Entity, reach: number): boolean =>
    manhattan(terrain, ground.anchorCell, entityNode(world, terrain, t)) <= reach;
  const lastResortOk = lastResortGate(
    terrain,
    index,
    ground.anchorCell,
    ground.radius,
    reachablePrey,
    lastResortLivestock,
  );
  // The last-resort gate stays last: it is the only clause that can walk rings, so out-of-ground and
  // carcass-blocked livestock must reject before it, not through it.
  const accept = (t: Entity): boolean =>
    acceptPrey(t) && within(t, ground.radius) && !groundHasCarcassWork() && lastResortOk(t);
  const leash = ground.radius + HUNT_CHASE_SLACK_NODES;
  const held = (t: Entity): boolean => acceptPrey(t) && within(t, leash) && !groundHasCarcassWork();
  return {
    accept,
    minDist,
    // From wherever the hunter stands, `dist(here, anchor) + radius` provably covers every in-ground
    // candidate (triangle inequality), and collapses to ~radius when it stands on its ground.
    searchRadius: manhattan(terrain, hereNode, ground.anchorCell) + ground.radius,
    player: null,
    lowPriority: lastResortLivestock,
    lock: { target: livePrey(world, e, held) },
    defend: { anchorCell: ground.anchorCell, leash, hold: false },
  };
}

/**
 * Admits any candidate but a `lastResort` head, and admits one of those only once no normal game stands
 * within {@link HUNT_LAST_RESORT_SCAN_FACTOR} x `radius` of `at` - a ring walk answered at most once per
 * engage, because it costs a multiple of the acquisition band.
 *
 * "Game around" is deliberately wider than what this hunter may take: a colleague's committed animal
 * counts, and so does game under fog - the one unfogged read in the hunting policy, because whether a
 * settlement may eat its own stock must not turn on the session's fog mode.
 */
function lastResortGate(
  terrain: TerrainGraph,
  index: CombatIndex,
  at: NodeId,
  radius: number,
  reachablePrey: (t: Entity) => boolean,
  lastResort: (t: Entity) => boolean,
): (t: Entity) => boolean {
  let gameless: boolean | null = null;
  const huntedOut = (): boolean => {
    if (gameless === null) {
      const { x, y } = terrain.coordsOf(at);
      const scan = radius * HUNT_LAST_RESORT_SCAN_FACTOR;
      gameless = index.nearest(x, y, 0, scan, (t) => !lastResort(t) && reachablePrey(t)) === null;
    }
    return gameless;
  };
  return (t) => !lastResort(t) || huntedOut();
}

/** Commit `target` as this hunter's prey - the write half of the `lock` the spec reads back. A stance that
 *  re-acquires freely instead sheds a hold left from an earlier one. A hold already on `target` is left
 *  untouched, keeping a long chase off the store's change generations. */
export function holdPrey(world: World, e: Entity, spec: EngageSpec, target: Entity): void {
  if (spec.lock === null) {
    world.remove(e, HuntFocus);
    return;
  }
  if (world.tryGet(e, HuntFocus)?.target !== target) world.add(e, HuntFocus, { target });
}

/** The prey this hunter is still committed to - its {@link HuntFocus} target while `holds` admits it, else
 *  null with the lapsed lock reaped here. `holds` runs only when a lock exists, keeping the carcass probe
 *  it closes over off the empty-handed path. */
function livePrey(world: World, e: Entity, holds: (t: Entity) => boolean): Entity | null {
  const focus = world.tryGet(e, HuntFocus);
  if (focus === undefined) return null;
  if (holds(focus.target)) return focus.target;
  world.remove(e, HuntFocus);
  return null;
}

/**
 * The prey every fellow hunter of the same player is committed to right now - the candidate set the
 * one-hunter-per-animal rule (authored) subtracts, so two hunters sharing a ground split the herd. A rival
 * player's hold is not subtracted: contested game stays contested. Membership only, so query order carries
 * no decision; hunters engage in canonical order, so a hold stamped earlier this same tick is already in it.
 */
function preyHeldByOthers(world: World, self: Entity): ReadonlySet<Entity> {
  const mine = ownerOf(world, self);
  const held = new Set<Entity>();
  for (const other of world.query(HuntFocus)) {
    if (other === self || !ownersCompatible(mine, ownerOf(world, other))) continue;
    held.add(world.get(other, HuntFocus).target);
  }
  return held;
}
