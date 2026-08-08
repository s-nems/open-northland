import {
  Carrying,
  Fleeing,
  Owner,
  PathRequest,
  Settler,
  type SettlerIdentity,
} from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { clearNavState, isTravelling, redirectRoute } from '../movement/nav-state.js';
import { isHunterJob } from '../readviews/index.js';
import { startDrop } from '../settlers/atomics/start.js';
import { COMPASS_DIRECTIONS, entityNode } from '../spatial/nodes.js';
import { playerSeesEntity } from '../vision/index.js';
import type { CombatIndex } from './combat-index.js';
import { isFleeThreat, SIGHT_RADIUS_NODES } from './targeting.js';

// The FLEE drive - the civilian raid reaction: path away from the nearest threat at the unit's normal pace
// (no run gait exists), wind a cool-down down once clear, and yield to a collapsing need.

/**
 * FLEE stance - how many ticks a fleeing unit must go with no threat in sight before it returns to the
 * economy, so it does not twitch in and out of flee as a threat flickers at the sight edge. Approximated
 * (source basis "Combat flee").
 */
const FLEE_COOLDOWN_TICKS = 40;

/**
 * FLEE stance - how many half-cell nodes a fleeing unit runs away from the nearest threat each time it
 * re-aims. Approximated - no readable flee distance (source basis "Combat flee").
 */
const FLEE_STEP_NODES = 12;

/**
 * FLEE stance - how many ticks a fleeing unit holds its current route before re-aiming away from the moving
 * threat. A per-tick re-path of every fleer would breach the scale budget; between re-aims the unit walks
 * its last route. Approximation (source basis "Combat flee").
 */
const FLEE_REPATH_CADENCE = 6;

/**
 * The need level (fixed-point, in [0, ONE]) at or above which a collapsing hunger or fatigue overrides the
 * FLEE drive, while every lesser need yields to it. Set well above the ¾ eat/sleep thresholds. Approximated
 * (source basis "Combat flee"): the original's flee-vs-need arbitration is unreadable.
 */
const NEED_COLLAPSE_THRESHOLD: Fixed = fx.div(fx.fromInt(19), fx.fromInt(20)); // 0.95·ONE

/**
 * The FLEE drive - run a unit away from the nearest threat. It reuses the combat ring-search index rather
 * than opening a scan of its own: the nearest hostile within {@link SIGHT_RADIUS_NODES} is the threat. A
 * collapsing need outranks the flee, and a clear sight line winds the cool-down down; otherwise the unit
 * re-aims away on the {@link FLEE_REPATH_CADENCE} throttle at its normal pace, since escape comes from
 * steering away rather than speed.
 */
export function fleeDrive(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  index: CombatIndex,
  e: Entity,
  attacker: SettlerIdentity,
): void {
  // Checked first so it wins over both the threat and the cool-down. Yield only on the transition out of
  // fleeing; once yielded, leave the need-walk alone so the eat/sleep goal the AI sets each tick survives.
  if (needCollapsing(world, e)) {
    if (world.has(e, Fleeing)) {
      world.remove(e, Fleeing);
      clearNavState(world, e);
    }
    return;
  }

  const here = entityNode(world, terrain, e);
  const { x, y } = terrain.coordsOf(here);
  // Fog gate: a fleer reacts only to threats its player currently sees. Any of the player's eyes counts, so
  // a watchtower spotting the raider warns a civilian whose own sight does not reach it.
  const viewer = world.tryGet(e, Owner);
  const accept = (t: Entity): boolean =>
    isFleeThreat(world, ctx, e, attacker, t) &&
    (viewer === undefined || playerSeesEntity(world, ctx.fog, viewer.player, t));
  // Near bound 0, not the weapon-reach floor of 1: fear has no dead zone, so a fleeing unit reacts to a
  // hostile on its very tile too. The coarse presence early-out (perf-only) spares every calm civilian its
  // per-tick full-sight ring scan; a FLEE-stance hunter is exempt from it, like every hunter spec.
  const threat =
    viewer !== undefined &&
    !isHunterJob(ctx.content, attacker.jobType) &&
    !index.othersWithin(viewer.player, x, y, SIGHT_RADIUS_NODES)
      ? null
      : index.nearest(x, y, 0, SIGHT_RADIUS_NODES, accept);
  const fleeing = world.tryGet(e, Fleeing);

  if (threat === null) {
    if (fleeing === undefined) return; // never in danger - the economy owns this unit
    let calmUntil = fleeing.calmUntil;
    if (calmUntil === null) {
      calmUntil = ctx.tick + FLEE_COOLDOWN_TICKS;
      world.mut(e, Fleeing).calmUntil = calmUntil;
    }
    if (ctx.tick >= calmUntil) {
      world.remove(e, Fleeing); // safe long enough - return to work
      clearNavState(world, e);
    }
    return;
  }

  // A settler cannot flee carrying a haul, so it drops its load and stands this tick, then runs empty-handed
  // the next. Strictly after the threat scan: an unconditional drop here strips every carrying civilian each
  // tick, a pickup-drop livelock that freezes builders, porters and gatherers on multi-player maps.
  if (world.has(e, Carrying)) {
    startDrop(world, ctx, e);
    return;
  }

  const f = world.add(e, Fleeing, { repathAt: fleeing?.repathAt ?? ctx.tick, calmUntil: null });
  const travelling = isTravelling(world, e);
  if (world.tryGet(e, PathRequest)?.failed) {
    clearNavState(world, e); // the last flee route was unreachable - re-aim now
  } else if (travelling && ctx.tick < f.repathAt) {
    return; // still running a live route - re-aim only on the throttle
  }

  const dest = fleeDestination(terrain, here, entityNode(world, terrain, threat.entity));
  if (dest === here) {
    clearNavState(world, e); // boxed in (no walkable away-cell) - stand and hope
  } else {
    // Keep the live route: dropping it resets the gait every re-aim, and a lurching fleer falls behind even
    // an equal-pace pursuer.
    redirectRoute(world, e, dest);
  }
  f.repathAt = ctx.tick + FLEE_REPATH_CADENCE;
}

/** The cell a fleeing unit should run to: the walkable cell {@link FLEE_STEP_NODES} away, of the eight
 *  compass directions, that is farthest from the threat, tie-broken by min cell id. A candidate must
 *  strictly beat staying put, so a boxed-in unit returns `here` rather than running toward the threat. */
export function fleeDestination(terrain: TerrainGraph, here: NodeId, threatCell: NodeId): NodeId {
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

/** Whether a settler's hunger or fatigue has reached the {@link NEED_COLLAPSE_THRESHOLD}, at which it stops
 *  to eat or sleep even in danger. */
function needCollapsing(world: World, e: Entity): boolean {
  const s = world.get(e, Settler);
  return s.hunger >= NEED_COLLAPSE_THRESHOLD || s.fatigue >= NEED_COLLAPSE_THRESHOLD;
}
