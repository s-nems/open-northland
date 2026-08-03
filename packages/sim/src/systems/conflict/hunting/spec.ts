import { HuntFocus, Settler } from '../../../components/index.js';
import { ownerOf, ownersCompatible } from '../../../components/ownership.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { isLastResortPrey } from '../../readviews/index.js';
import { entityNode, manhattan, type NodeBuckets } from '../../spatial/nodes.js';
import type { EngageSpec } from '../engagement.js';
import { isHuntTarget } from '../targeting.js';
import { HUNT_CHASE_SLACK_NODES, HUNT_LAST_RESORT_SCAN_FACTOR, huntingGround } from './ground.js';
import { huntingGroundHoldsCarcass } from './kill-claim.js';

// The hunter's PREY-ACQUISITION policy - what an owned IGNORE hunter engages under. Split out of
// engagement.ts (the stance dispatch) so the tiering, the ground bound and the prey commitment live in
// one place. ./ground.ts owns where it hunts, ./kill-claim.ts owns which bodies are its work.

/**
 * How long (ticks) a hunter's prey acquisition rests after a search that found nothing (`HuntRest` - the
 * cost rationale lives on the component). 10 ticks ≈ 0.8 s: a ~10x amortization the player cannot see.
 * Pure pacing, no source basis.
 */
export const HUNT_SEARCH_REST_TICKS = 10;

/**
 * The hunter's target-acquisition spec, and the owner of the ONE-KILL-AT-A-TIME rule (user rule): while
 * the ground holds a harvestable carcass ({@link huntingGroundHoldsCarcass}) the hunter takes no new
 * target - the harvest drive carries the kill home first - and the carry leg after the last pickup is
 * shielded a rung above (`carriesKillHome`). Accepts only huntable prey inside the hunting ground
 * ({@link huntingGround}), the ground anchor leashing the chase; never `hold` - an idle hunter belongs
 * to its flag-gatherer drive. Prey a fellow hunter has committed to is no candidate at all
 * ({@link preyHeldByOthers}). A hunter with neither flag nor workplace (an unposted fixture) hunts by
 * plain sight, unanchored.
 *
 * Last-resort livestock (huntPrey `lastResort`; user rule) is fenced off twice: `lowPriority` keeps
 * normal game in the ground ahead of it, and {@link lastResortGate} refuses it outright while real game
 * stands in the wider probe, so a dry ground idles the hunter at its flag instead of turning it on the
 * settlement's herd. Only acquisition is gated - an animal already drawn on is still run down.
 *
 * It also owns the ONE-PREY-AT-A-TIME rule (user rule): the spec's `lock` holds the animal the hunter
 * drew on until it drops, out to the CHASE LEASH rather than the tighter acquisition radius - prey bolts
 * on the first arrow, so expiring at the acquisition line would restore the very swap the lock prevents.
 * Building the spec MUTATES: a lock this tick's rules no longer admit is reaped as it is read.
 */
export function hunterEngageSpec(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: NodeBuckets,
  e: Entity,
  jobType: number | null,
  seesTarget: (t: Entity) => boolean,
  minDist: number,
  sight: number,
): EngageSpec {
  const hereNode = entityNode(world, terrain, e);
  const hunterComponent = terrain.componentOf(hereNode);
  // Lazily resolved on the first candidate: a hunter that never reaches one pays nothing for the set.
  let colleagueHolds: ReadonlySet<Entity> | null = null;
  const heldByColleague = (t: Entity): boolean => {
    colleagueHolds ??= preyHeldByOthers(world, e);
    return colleagueHolds.has(t);
  };
  // An animal across a static terrain seam (an island, the far bank) is not this hunter's game: taking
  // it would hold the unit in a chase re-issuing a route that can never resolve. The same rule the
  // carcass gate applies to a stranded kill.
  const reachablePrey = (t: Entity): boolean =>
    isHuntTarget(world, ctx, t, jobType) &&
    terrain.componentOf(entityNode(world, terrain, t)) === hunterComponent;
  const acceptPrey = (t: Entity): boolean => reachablePrey(t) && !heldByColleague(t) && seesTarget(t);
  const lastResortLivestock = (t: Entity): boolean => {
    const s = world.tryGet(t, Settler);
    return s !== undefined && isLastResortPrey(ctx.content, s.tribe);
  };
  // `player` is null in every hunter spec: a hunter is never presence-gated, in any stance - its prey
  // filter admits the passive wildlife the presence grid discounts (see HostilePresence).
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
  // Lazily memoized per engage: probed at most once, on the first candidate (or held target) to reach it.
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
  // The last-resort gate stays LAST: it is the only clause that can walk rings, so out-of-ground and
  // carcass-blocked livestock must reject before it, not through it.
  const accept = (t: Entity): boolean =>
    acceptPrey(t) && within(t, ground.radius) && !groundHasCarcassWork() && lastResortOk(t);
  const leash = ground.radius + HUNT_CHASE_SLACK_NODES;
  const held = (t: Entity): boolean => acceptPrey(t) && within(t, leash) && !groundHasCarcassWork();
  return {
    accept,
    minDist,
    // From wherever the hunter stands, `dist(here, anchor) + radius` provably covers every in-ground
    // candidate (triangle inequality) - and collapses to ~radius when it stands on its ground, where
    // the naive `radius + leash` band would ring-walk 4x the nodes every awake tick.
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
 * counts (subtracting {@link HuntFocus} would make the answer depend on how many colleagues had already
 * engaged this tick, since {@link holdPrey} writes after the search), and so does game under fog - the
 * one unfogged read in the hunting policy, because whether a settlement may eat its own stock must not
 * turn on the session's fog mode.
 */
function lastResortGate(
  terrain: TerrainGraph,
  index: NodeBuckets,
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

/** Commit `target` as this hunter's prey for the ticks to come - the write half of the `lock` the spec
 *  reads back. A stance that re-acquires freely instead SHEDS a hold left from an earlier one (a hunter
 *  switched to DEFEND fights under general hostility; its half-finished hunt is over) - only the hunting
 *  branch can reap it, so nothing else would. A hold already on `target` is left untouched, keeping a
 *  long chase off the store's change generations. */
export function holdPrey(world: World, e: Entity, spec: EngageSpec, target: Entity): void {
  if (spec.lock === null) {
    world.remove(e, HuntFocus);
    return;
  }
  if (world.tryGet(e, HuntFocus)?.target !== target) world.add(e, HuntFocus, { target });
}

/** The prey this hunter is still committed to - its {@link HuntFocus} target while `holds` admits it,
 *  else null with the lapsed lock reaped here, so a hunter whose animal died, was banked, or outran the
 *  leash acquires freely again. `holds` runs only when a lock exists, keeping the carcass probe it
 *  closes over off the empty-handed path. */
function livePrey(world: World, e: Entity, holds: (t: Entity) => boolean): Entity | null {
  const focus = world.tryGet(e, HuntFocus);
  if (focus === undefined) return null;
  if (holds(focus.target)) return focus.target;
  world.remove(e, HuntFocus);
  return null;
}

/**
 * The prey every fellow hunter of the same player is committed to right now ({@link HuntFocus}) - the
 * candidate set the ONE HUNTER PER ANIMAL rule (user rule 2026-08-03) subtracts, so two hunters sharing
 * a ground split the herd instead of both drawing on the nearest deer. A rival player's hold is not
 * subtracted: contested game stays contested. Membership only, so query order carries no decision;
 * hunters engage in canonical order within the tick, so a hold {@link holdPrey} stamped earlier this
 * same tick is already in it and two hunters never leave one pass on one animal.
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
