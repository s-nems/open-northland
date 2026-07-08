import { Fleeing, MoveGoal, PathRequest, Settler } from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { CellId, TerrainGraph } from '../../nav/terrain.js';
import type { SystemContext } from '../context.js';
import { COMPASS_DIRECTIONS, type TileBuckets, clearNavState, entityCell, isTravelling } from '../spatial.js';
import { SIGHT_RADIUS_TILES, isValidTarget } from './targeting.js';

// The FLEE drive — the civilian raid reaction (the FLEE stance's active behaviour): run from the
// nearest threat at the run gait, wind a cool-down down once clear, and yield to a collapsing need.

/**
 * FLEE stance — how many ticks a fleeing unit must go with **no threat in sight** before it stops running
 * and returns to the economy (the cool-down). Prevents a unit twitching in and out of flee as a threat
 * flickers at the sight edge. APPROXIMATED (source basis "Combat flee").
 */
const FLEE_COOLDOWN_TICKS = 40;

/**
 * FLEE stance — how many tiles a fleeing unit runs **away** from the nearest threat each time it re-aims:
 * the flee destination is the walkable cell this far off in the best away-direction. APPROXIMATED — no
 * readable flee-distance (source basis "Combat flee").
 */
const FLEE_STEP_TILES = 6;

/**
 * FLEE stance — how many ticks a fleeing unit holds its current run route before re-aiming away from the
 * (moving) threat. The flee twin of {@link REPATH_CADENCE}: a per-tick re-path of every fleer would be the
 * RTS-scale regression golden rule 7 forbids; between re-aims the unit runs its last route (the run gait
 * keeps it ahead of a walking pursuer). OUR design (source basis "Combat flee").
 */
const FLEE_REPATH_CADENCE = 6;

/**
 * The need level (fixed-point, in [0, ONE]) at or above which a **collapsing** hunger/fatigue overrides the
 * FLEE drive — a settler this close to starving/collapsing stops to eat/sleep even in danger (the AISystem's
 * need drive then owns it), while every lesser need yields to the flee. Set well ABOVE the ¾ eat/sleep
 * thresholds (a fleeing settler skips normal meals but not a near-death one). APPROXIMATED (source basis
 * "Combat flee"): the original's flee-vs-need arbitration is unreadable.
 */
const NEED_COLLAPSE_THRESHOLD: Fixed = fx.div(fx.fromInt(19), fx.fromInt(20)); // 0.95·ONE

/** The compass directions (the shared canonical ring — spatial.ts) a fleeing unit considers running
 *  toward — the best (farthest-from-threat, walkable) one is chosen, so an obstacle in the
 *  straight-away direction diverts the run deterministically rather than freezing it. The same
 *  tuple the herd-spawn scatter walks, so the two direction sets can never drift. */
const FLEE_DIRECTIONS = COMPASS_DIRECTIONS;

/**
 * The FLEE drive — run a unit away from the nearest threat (the civilian raid reaction). Reuses the combat
 * ring-search index (no new scan, golden rule 7): the nearest hostile within {@link SIGHT_RADIUS_TILES} is
 * the threat. Then, in order:
 *  - **no threat in sight** → wind the cool-down down: start it on the first clear tick, and after
 *    {@link FLEE_COOLDOWN_TICKS} clear with none, shed {@link Fleeing} + the run route so the economy
 *    re-tasks the unit; while cooling down it holds its last route. A unit that was never fleeing does
 *    nothing (the economy owns it).
 *  - **a collapsing need** ({@link needCollapsing}) → a near-death hunger/fatigue overrides the flee: on the
 *    transition out of fleeing (Fleeing still set) shed the marker + run route so the AISystem's eat/sleep
 *    drive owns the unit; once yielded, leave that need-walk untouched (don't cancel it each tick).
 *  - **flee** → stamp/refresh {@link Fleeing} (calmUntil null = in danger), and — throttled to
 *    {@link FLEE_REPATH_CADENCE}, or immediately on a failed route — re-aim to a walkable cell
 *    {@link FLEE_STEP_TILES} away in the best direction AWAY from the threat ({@link fleeDestination}). The
 *    MovementSystem walks a Fleeing unit at the faster run gait, so it outpaces a walking pursuer.
 */
export function fleeDrive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: TileBuckets,
  e: Entity,
  attacker: { tribe: number; jobType: number | null },
): void {
  // A COLLAPSING need (near-death hunger/fatigue) overrides the flee whether or not a threat is in sight —
  // the settler stops to eat/sleep even in danger, and doesn't sit idle through the cool-down after a
  // threat leaves. Yield only on the transition (Fleeing still set): shed the marker + the run route so the
  // AISystem re-tasks the unit; once yielded (no marker) leave the need-walk alone so we don't cancel the
  // eat/sleep goal the AI sets each tick. (Checked FIRST so it wins over both the threat and the cool-down.)
  if (needCollapsing(world, e)) {
    if (world.has(e, Fleeing)) {
      world.remove(e, Fleeing);
      clearNavState(world, e);
    }
    return;
  }

  const here = entityCell(world, terrain, e);
  const { x, y } = terrain.coordsOf(here);
  const accept = (t: Entity): boolean => isValidTarget(world, ctx, e, attacker, t);
  // Near bound 0 (not the weapon-reach floor of 1): fear has no dead zone — a fleeing unit reacts to a
  // hostile on its very tile too (entities share tiles freely), not just one a step away.
  const threat = index.nearest(x, y, 0, SIGHT_RADIUS_TILES, accept);
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

  const f = world.add(e, Fleeing, { repathAt: fleeing?.repathAt ?? ctx.tick, calmUntil: null });
  const travelling = isTravelling(world, e);
  if (world.tryGet(e, PathRequest)?.failed) {
    clearNavState(world, e); // the last flee route was unreachable — re-aim now
  } else if (travelling && ctx.tick < f.repathAt) {
    return; // still running a live route — re-aim only on the throttle
  }

  const dest = fleeDestination(terrain, here, entityCell(world, terrain, threat.entity));
  clearNavState(world, e);
  if (dest !== here) world.add(e, MoveGoal, { cell: dest }); // dest === here ⇒ boxed in, stand and hope
  f.repathAt = ctx.tick + FLEE_REPATH_CADENCE;
}

/** The cell a fleeing unit should run to: the walkable cell {@link FLEE_STEP_TILES} away (of the eight
 *  compass directions) that is FARTHEST from the threat, tie-broken by min cell id. It must strictly
 *  increase the distance from the threat over staying put, so a boxed-in unit (no away-cell walkable /
 *  in-bounds) returns its own cell (`here`) and stays rather than running toward the threat. A bounded
 *  8-way scan — deterministic (fixed direction order + min-id tie-break), no RNG. */
function fleeDestination(terrain: TerrainGraph, here: CellId, threatCell: CellId): CellId {
  const h = terrain.coordsOf(here);
  const t = terrain.coordsOf(threatCell);
  let best: CellId = here;
  let bestScore = Math.abs(h.x - t.x) + Math.abs(h.y - t.y); // a candidate must beat staying put
  for (const [dx, dy] of FLEE_DIRECTIONS) {
    const x = h.x + dx * FLEE_STEP_TILES;
    const y = h.y + dy * FLEE_STEP_TILES;
    if (!terrain.inBounds(x, y)) continue;
    const cell = terrain.cellAt(x, y);
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
