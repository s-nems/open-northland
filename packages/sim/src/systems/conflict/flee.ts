import { Carrying, Fleeing, Owner, PathRequest, Settler, type SettlerIdentity } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import { startDrop } from '../agents/actions.js';
import type { SystemContext } from '../context.js';
import {
  COMPASS_DIRECTIONS,
  clearNavState,
  entityNode,
  isTravelling,
  type NodeBuckets,
  redirectRoute,
} from '../spatial.js';
import { playerSeesEntity } from '../vision/index.js';
import type { HostilePresence } from './presence.js';
import { isValidTarget, SIGHT_RADIUS_NODES } from './targeting.js';

// The FLEE drive — the civilian raid reaction (the FLEE stance's active behaviour): path away from the nearest
// threat (at the unit's normal pace — no run gait exists), wind a cool-down down once clear, and yield to a
// collapsing need.

/**
 * FLEE stance — how many ticks a fleeing unit must go with no threat in sight before it stops running and
 * returns to the economy (the cool-down). Prevents a unit twitching in and out of flee as a threat flickers at
 * the sight edge. Approximated (source basis "Combat flee").
 */
const FLEE_COOLDOWN_TICKS = 40;

/**
 * FLEE stance — how many half-cell nodes a fleeing unit runs away from the nearest threat each time it re-aims:
 * the flee destination is the walkable node this far off in the best away-direction. Approximated — no readable
 * flee-distance (source basis "Combat flee"); doubled with the half-cell migration (same on-screen distance as
 * the old 6-cell value).
 */
const FLEE_STEP_NODES = 12;

/**
 * FLEE stance — how many ticks a fleeing unit holds its current route before re-aiming away from the (moving)
 * threat. The flee twin of {@link REPATH_CADENCE}: a per-tick re-path of every fleer would be the RTS-scale
 * regression the budget rule forbids; between re-aims the unit walks its last route. Our design (source basis
 * "Combat flee").
 */
const FLEE_REPATH_CADENCE = 6;

/**
 * The need level (fixed-point, in [0, ONE]) at or above which a collapsing hunger/fatigue overrides the FLEE
 * drive — a settler this close to starving stops to eat/sleep even in danger (the AISystem's need drive then
 * owns it), while every lesser need yields to the flee. Set well above the ¾ eat/sleep thresholds. Approximated
 * (source basis "Combat flee"): the original's flee-vs-need arbitration is unreadable.
 */
const NEED_COLLAPSE_THRESHOLD: Fixed = fx.div(fx.fromInt(19), fx.fromInt(20)); // 0.95·ONE

/**
 * The FLEE drive — run a unit away from the nearest threat (the civilian raid reaction). Reuses the combat
 * ring-search index (no new scan, the RTS-scale budget): the nearest hostile within {@link SIGHT_RADIUS_NODES} is the
 * threat. Then, in order:
 *  - **no threat in sight** → wind the cool-down down: start it on the first clear tick, and after
 *    {@link FLEE_COOLDOWN_TICKS} clear with none, shed {@link Fleeing} + the flee route so the economy re-tasks
 *    the unit; while cooling down it holds its last route. A unit that was never fleeing does nothing.
 *  - **a collapsing need** ({@link needCollapsing}) → a near-death hunger/fatigue overrides the flee: on the
 *    transition out of fleeing (Fleeing still set) shed the marker + flee route so the AISystem's eat/sleep
 *    drive owns the unit; once yielded, leave that need-walk untouched.
 *  - **flee** → stamp/refresh {@link Fleeing} (calmUntil null = in danger), and — throttled to
 *    {@link FLEE_REPATH_CADENCE}, or immediately on a failed route — re-aim to a walkable cell
 *    {@link FLEE_STEP_NODES} away in the best direction away from the threat ({@link fleeDestination}). The
 *    unit walks at its normal pace — escape comes from steering away, not speed.
 */
export function fleeDrive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: NodeBuckets,
  presence: HostilePresence,
  e: Entity,
  attacker: SettlerIdentity,
): void {
  // A collapsing need overrides the flee whether or not a threat is in sight, and is checked first so it wins
  // over both the threat and the cool-down. Yield only on the transition (Fleeing still set): shed the marker +
  // flee route so the AISystem re-tasks the unit; once yielded (no marker) leave the need-walk alone so we
  // don't cancel the eat/sleep goal the AI sets each tick.
  if (needCollapsing(world, e)) {
    if (world.has(e, Fleeing)) {
      world.remove(e, Fleeing);
      clearNavState(world, e);
    }
    return;
  }

  const here = entityNode(world, terrain, e);
  const { x, y } = terrain.coordsOf(here);
  // Fog gate: a fleer reacts only to threats its player currently sees (the combat auto-acquire's twin). Any of
  // the player's eyes counts: a watchtower spotting the raider warns the civilian even when the civilian's own
  // short sight doesn't reach it.
  const viewer = world.tryGet(e, Owner);
  const accept = (t: Entity): boolean =>
    isValidTarget(world, ctx, e, attacker, t) &&
    (viewer === undefined || playerSeesEntity(world, ctx.fog, viewer.player, t));
  // Near bound 0 (not the weapon-reach floor of 1): fear has no dead zone — a fleeing unit reacts to a
  // hostile on its very tile too (entities share tiles freely), not just one a step away. The coarse
  // presence early-out (perf-only, conservative — see HostilePresence) spares every calm civilian on a
  // peaceful two-player map its per-tick full-sight ring scan; only owned units carry the FLEE stance.
  const threat =
    viewer !== undefined && !presence.othersWithin(viewer.player, x, y, SIGHT_RADIUS_NODES)
      ? null
      : index.nearest(x, y, 0, SIGHT_RADIUS_NODES, accept);
  const fleeing = world.tryGet(e, Fleeing);

  if (threat === null) {
    if (fleeing === undefined) return; // never in danger — the economy owns this unit
    if (fleeing.calmUntil === null) fleeing.calmUntil = ctx.tick + FLEE_COOLDOWN_TICKS;
    if (ctx.tick >= fleeing.calmUntil) {
      world.remove(e, Fleeing); // safe long enough — return to work
      clearNavState(world, e);
    }
    return;
  }

  // Hands full with a threat actually in sight: the settler drops its load before it runs — it can't flee
  // carrying a haul (the drop-on-interrupt rule). Start the drop atomic and stand this tick; the combat gate
  // (engageCombatant skips a unit with a CurrentAtomic) holds it here until the load is on the ground, then
  // the next tick it flees empty-handed. Strictly AFTER the threat scan: fleeDrive runs every tick for every
  // FLEE-stance unit whenever combat is awake at all (any two-player map), so an unconditional drop here
  // stripped every carrying civilian each tick — the pickup→drop livelock that froze builders/porters/
  // gatherers on multi-player maps.
  if (world.has(e, Carrying)) {
    startDrop(world, ctx, e);
    return;
  }

  const f = world.add(e, Fleeing, { repathAt: fleeing?.repathAt ?? ctx.tick, calmUntil: null });
  const travelling = isTravelling(world, e);
  if (world.tryGet(e, PathRequest)?.failed) {
    clearNavState(world, e); // the last flee route was unreachable — re-aim now
  } else if (travelling && ctx.tick < f.repathAt) {
    return; // still running a live route — re-aim only on the throttle
  }

  const dest = fleeDestination(terrain, here, entityNode(world, terrain, threat.entity));
  if (dest === here) {
    clearNavState(world, e); // boxed in (no walkable away-cell) — stand and hope
  } else {
    // Keep the live route — dropping it resets the gait every re-aim, and a lurching fleer falls behind even an
    // equal-pace pursuer (the pace is constant by design).
    redirectRoute(world, e, dest);
  }
  f.repathAt = ctx.tick + FLEE_REPATH_CADENCE;
}

/** The cell a fleeing unit should run to: the walkable cell {@link FLEE_STEP_NODES} away (of the eight compass
 *  directions) that is farthest from the threat, tie-broken by min cell id. It must strictly increase the
 *  distance from the threat over staying put, so a boxed-in unit (no away-cell walkable / in-bounds) returns
 *  its own cell (`here`) and stays rather than running toward the threat. Deterministic (fixed direction order
 *  + min-id tie-break), no RNG. */
function fleeDestination(terrain: TerrainGraph, here: NodeId, threatCell: NodeId): NodeId {
  const h = terrain.coordsOf(here);
  const t = terrain.coordsOf(threatCell);
  let best: NodeId = here;
  let bestScore = Math.abs(h.x - t.x) + Math.abs(h.y - t.y); // a candidate must beat staying put
  for (const [dx, dy] of COMPASS_DIRECTIONS) {
    const x = h.x + dx * FLEE_STEP_NODES;
    const y = h.y + dy * FLEE_STEP_NODES;
    if (!terrain.inBounds(x, y)) continue;
    const cell = terrain.nodeAt(x, y);
    if (!terrain.isWalkable(cell)) continue;
    const score = Math.abs(x - t.x) + Math.abs(y - t.y);
    if (score > bestScore || (score === bestScore && best !== here && cell < best)) {
      best = cell;
      bestScore = score;
    }
  }
  return best;
}

/** Whether a settler's hunger or fatigue has reached the {@link NEED_COLLAPSE_THRESHOLD} — a near-death
 *  need that overrides the FLEE drive (the settler stops to eat/sleep even in danger). */
function needCollapsing(world: World, e: Entity): boolean {
  const s = world.get(e, Settler);
  return s.hunger >= NEED_COLLAPSE_THRESHOLD || s.fatigue >= NEED_COLLAPSE_THRESHOLD;
}
