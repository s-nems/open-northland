import {
  AttackOrder,
  Carrying,
  Fleeing,
  hasMissionBehaviour,
  MISSION_BEHAVIOUR,
  MoveGoal,
  Owner,
  PathRequest,
  PlayerOrder,
  type SettlerIdentity,
  SettlerNeeds,
  Sheltering,
} from '../../components/index.js';
import { type Fixed, fx } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay } from '../../nav/block-overlay.js';
import { hexDistanceBetween } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph, Traversal } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { needLevel } from '../lifecycle/needs/levels.js';
import { clearNavState, isTravelling, redirectRoute } from '../movement/nav-state.js';
import { settlerMovementNode, settlerTraversal } from '../movement/traversal.js';
import { isFighterJob, isHunterJob, type MilitaryMode, stanceFights } from '../readviews/index.js';
import { atomicHoldsSettler } from '../settlers/atomics/busy.js';
import { startDrop } from '../settlers/atomics/start.js';
import { COMPASS_DIRECTIONS, entityNode } from '../spatial/nodes.js';
import { playerSeesEntity } from '../vision/index.js';
import type { CombatIndex } from './combat-index.js';
import { isFleeThreat, SIGHT_RADIUS_NODES } from './targeting.js';

// The FLEE drive - the civilian raid reaction: path away from the threats in sight at the unit's normal pace
// (no run gait exists), wind a cool-down down once clear, and yield to a collapsing need. The run a blow
// starts for anyone who is not a fighter lives here too.

/**
 * FLEE stance - how many ticks a fleeing unit must go with no threat in sight before it returns to the
 * economy, so it does not twitch in and out of flee as a threat flickers at the sight edge. Approximated
 * (source basis "Combat flee").
 */
const FLEE_COOLDOWN_TICKS = 40;

/**
 * FLEE stance - how many half-cell nodes a fleeing unit runs away from the threats in sight each time it
 * re-aims, and a frightened animal from its scare, along one of the eight walk directions. The original
 * runs a struck civilian 10 map points from its attacker; this is 10 map points along a row or a column and
 * up to 15 on a diagonal, an approximation. Running from any threat in sight, not only from a blow, is
 * this sim's FLEE stance.
 */
export const FLEE_STEP_NODES = 10;

/**
 * FLEE stance - how many ticks a fleeing unit holds its current route before re-aiming away from the moving
 * threat. A per-tick re-path of every fleer would breach the scale budget; between re-aims the unit walks
 * its last route. Approximation (source basis "Combat flee").
 */
export const FLEE_REPATH_CADENCE = 6;

/**
 * FLEE stance - a calm unit looks for a threat only on ticks where `tick + entity` is a multiple of this
 * stride, which spreads the checks evenly; a unit already fleeing looks every tick. Approximation for scale:
 * a raider coming into sight is noticed up to three ticks (a quarter second) late.
 */
export const FLEE_CHECK_STRIDE_TICKS = 4;

/**
 * FLEE stance - how many of the nearest threats in sight a re-aim steers away from at once, so a civilian
 * caught between raiders does not run from the nearest one straight at the next. Approximation for scale:
 * one per walk direction.
 */
export const FLEE_THREAT_LIMIT = 8;

const NO_THREATS: readonly { entity: Entity; distance: number }[] = [];

/**
 * The need level (fixed-point, in [0, ONE]) at or above which a collapsing hunger or fatigue overrides the
 * FLEE drive, while every lesser need yields to it. Set well above the ¾ eat/sleep thresholds. Approximated
 * (source basis "Combat flee"): the original's flee-vs-need arbitration is unreadable.
 */
const NEED_COLLAPSE_THRESHOLD: Fixed = fx.div(fx.fromInt(19), fx.fromInt(20)); // 0.95·ONE

/**
 * The FLEE drive - run a unit away from the threats in sight. It reuses the combat target index rather
 * than opening a scan of its own: a hostile within {@link SIGHT_RADIUS_NODES} is a threat, looked for on
 * the {@link FLEE_CHECK_STRIDE_TICKS} stride while calm. A collapsing need outranks the flee,
 * and a clear sight line winds the cool-down down; otherwise the unit re-aims away on the
 * {@link FLEE_REPATH_CADENCE} throttle at its normal pace, since escape comes from steering away rather
 * than speed.
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
  if (needCollapsing(world, ctx.tick, e)) {
    if (world.has(e, Fleeing)) {
      world.remove(e, Fleeing);
      clearNavState(world, e);
    }
    return;
  }
  if (!world.has(e, Fleeing) && (ctx.tick + e) % FLEE_CHECK_STRIDE_TICKS !== 0) return;
  // A blow's run still owed, its runner's clip over: it goes before any look around.
  if (world.tryGet(e, Fleeing)?.blow !== undefined) {
    startBlowRun(world, ctx, terrain, e);
    return;
  }

  const here = settlerMovementNode(world, terrain, e);
  const { x, y } = terrain.coordsOf(here);
  // Fog gate: a fleer reacts only to threats its player currently sees. Any of the player's eyes counts, so
  // a watchtower spotting the raider warns a civilian whose own sight does not reach it.
  const viewer = world.tryGet(e, Owner);
  const accept = (t: Entity): boolean =>
    isFleeThreat(world, ctx, e, attacker, t, index.firing) &&
    (viewer === undefined || playerSeesEntity(world, ctx.fog, viewer.player, t));
  const fleeing = world.tryGet(e, Fleeing);
  // A re-aim steers from the nearest few threats; any other tick only asks whether one is still in sight,
  // which needs no ranking.
  const reaims = fleeing === undefined || ctx.tick >= fleeing.repathAt;
  // Near bound 0, not the weapon-reach floor of 1: fear has no dead zone, so a fleeing unit reacts to a
  // hostile on its very tile too. The coarse presence early-out (perf-only) spares a calm civilian its
  // full-sight scan; a FLEE-stance hunter is exempt from it, like every hunter spec. The tail reaches the
  // whole sight radius, so only the limit ends the take.
  const seeker = viewer?.player ?? null;
  const cleared =
    viewer !== undefined &&
    !isHunterJob(ctx.content, attacker.jobType) &&
    !index.threatsWithin(viewer.player, x, y, SIGHT_RADIUS_NODES);
  const threats =
    cleared || !reaims
      ? NO_THREATS
      : index.nearestFew(
          x,
          y,
          0,
          SIGHT_RADIUS_NODES,
          accept,
          FLEE_THREAT_LIMIT,
          seeker,
          SIGHT_RADIUS_NODES,
          'hex',
        );
  const threatened = reaims
    ? threats.length > 0
    : !cleared && index.anyWithin(x, y, 0, SIGHT_RADIUS_NODES, accept, seeker, 'hex');

  if (!threatened) {
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

  // A threat back in sight ends the cool-down; a flee in progress is otherwise left unwritten.
  if (fleeing === undefined) world.add(e, Fleeing, { repathAt: ctx.tick, calmUntil: null });
  else if (fleeing.calmUntil !== null) world.mut(e, Fleeing).calmUntil = null;
  if (world.tryGet(e, PathRequest)?.failed) clearNavState(world, e); // the last flee route was unreachable
  // Run the live route, or stand out a refused or boxed-in one, until the throttle re-aims.
  if (!reaims) return;

  const threatCells = threats.map((t) => entityNode(world, terrain, t.entity));
  const dest = fleeDestination(terrain, dynamicBlockOverlay(world, ctx, terrain), here, threatCells);
  // The run under way holds while the fresh aim points the same way or lies no farther from the nearest
  // threat: re-routing to a cell one step on only churns the path, and a threat flickering at the sight edge
  // must not turn the fleer back and forth.
  const goal = fleeing === undefined ? undefined : world.tryGet(e, MoveGoal)?.cell;
  const holds = goal !== undefined && goal !== here && runHolds(terrain, here, goal, dest, threatCells);
  if (!holds && dest === here) {
    clearNavState(world, e); // boxed in (no walkable away-cell) - stand and hope
  } else if (!holds) {
    // Keep the live route: dropping it resets the gait every re-aim, and a lurching fleer falls behind even
    // an equal-pace pursuer.
    redirectRoute(world, e, dest);
  }
  world.mut(e, Fleeing).repathAt = ctx.tick + FLEE_REPATH_CADENCE;
}

/**
 * Who runs from a blow on itself or beside it: anyone who is not a fighter, under any stance but one the
 * player set to fight. Original behavior: every non-soldier runs whatever its stance. Deviation: a civilian
 * the player set to ATTACK or DEFEND stands, as that setting says; a fighter's answer is to turn, never run.
 */
export function runsFromBlows(ctx: SystemContext, runner: SettlerIdentity, mode: MilitaryMode): boolean {
  return !isFighterJob(ctx.content, runner.jobType) && !stanceFights(mode);
}

/**
 * Start `e` running a {@link FLEE_STEP_NODES} step away from `from`, the node a blow on it or on a
 * neighbour came from. Original behavior. It stands instead while already running, sheltering, under a
 * player's order, too worn out to run or script-passive: gates of this sim's own (approximation: the
 * original's own gates are not all mapped onto these). A runner a clip holds, the struck one flinching or
 * a worker mid-stroke, owes the run until the clip ends, and one that carries a haul sets it down first.
 * Under FLEE the drive then keeps it running from what it sees and winds down after
 * {@link FLEE_COOLDOWN_TICKS} in the clear; under any other stance the run is the whole reaction, and the
 * unit goes back to its work where it ends.
 */
export function runFromBlow(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  e: Entity,
  from: NodeId,
): void {
  if (world.has(e, Fleeing) || world.has(e, Sheltering) || world.has(e, PlayerOrder)) return;
  if (world.has(e, AttackOrder) || needCollapsing(world, ctx.tick, e)) return;
  if (hasMissionBehaviour(world, e, MISSION_BEHAVIOUR.PASSIVE)) return; // a script-passive unit stands and takes it
  world.add(e, Fleeing, { repathAt: ctx.tick + FLEE_REPATH_CADENCE, calmUntil: null, blow: from });
  if (!atomicHoldsSettler(world, e)) startBlowRun(world, ctx, terrain, e);
}

/**
 * Issue the run `e` owes for a blow: drop a haul first (the drop clip re-owes it), else route away from
 * the blow's node and clear the debt. Answers whether the runner is still on its way, walking or dropping;
 * a boxed-in one has nowhere to run and its debt is cleared with it standing. A run whose route the
 * routing refused ends where the runner stands: the away-cell was walkable but sealed off, and a runner left
 * holding the failed request would stay fleeing for good, since only the marker's owner re-plans it.
 */
export function startBlowRun(world: World, ctx: SystemContext, terrain: TerrainGraph, e: Entity): boolean {
  const fleeing = world.get(e, Fleeing);
  const from = fleeing.blow;
  if (from === undefined) {
    if (world.tryGet(e, PathRequest)?.failed !== true) return isTravelling(world, e);
    clearNavState(world, e);
    return false;
  }
  if (world.has(e, Carrying)) {
    startDrop(world, ctx, e);
    return true;
  }
  world.mut(e, Fleeing).blow = undefined;
  const here = settlerMovementNode(world, terrain, e);
  const dest = fleeDestination(
    terrain,
    dynamicBlockOverlay(world, ctx, terrain),
    here,
    [from],
    undefined,
    undefined,
    settlerTraversal(world, e),
  );
  if (dest === here) {
    clearNavState(world, e);
    return false;
  }
  redirectRoute(world, e, dest);
  return true;
}

/** The cell a fleeing unit should run to: the cell `step` nodes away, of the eight compass directions, that is
 *  farthest from the nearest threat in `threatCells`, so a runner does not head from one threat at another,
 *  then farthest from them all together, which picks the gap in a ring of threats, tie-broken by min cell
 *  id. Distances are map points. Where `admits` refuses that cell, the direction's nearer cells stand in
 *  for it, the farthest admitted first. A candidate must be one a route can reach: walkable, outside the
 *  `blocked` walk-block, and in the runner's static walk component (a runner on an unwalkable node is
 *  unlabelled and admits every component). It must also strictly beat staying put, so a boxed-in unit
 *  returns `here` rather than running toward a threat. */
export function fleeDestination(
  terrain: TerrainGraph,
  blocked: BlockOverlay,
  here: NodeId,
  threatCells: readonly NodeId[],
  step: number = FLEE_STEP_NODES,
  admits: (cell: NodeId) => boolean = () => true,
  traversal: Traversal = 'land',
): NodeId {
  const h = terrain.coordsOf(here);
  const threats = threatCells.map((t) => terrain.coordsOf(t));
  const bank = terrain.componentOf(here);
  let best: NodeId = here;
  // A candidate must beat staying put.
  let bestClearance = nearestThreat(threats, h.x, h.y);
  let bestTotal = allThreats(threats, h.x, h.y);
  for (const [dx, dy] of COMPASS_DIRECTIONS) {
    if (!terrain.inBounds(h.x + dx * step, h.y + dy * step)) continue;
    let reach = step;
    while (reach > 0 && !admits(terrain.nodeAt(h.x + dx * reach, h.y + dy * reach))) reach--;
    if (reach === 0) continue;
    const x = h.x + dx * reach;
    const y = h.y + dy * reach;
    const cell = terrain.nodeAt(x, y);
    if (!terrain.traversable(cell, traversal) || blocked.has(cell)) continue;
    if (bank >= 0 && terrain.componentOf(cell) !== bank) continue;
    const clearance = nearestThreat(threats, x, y);
    const total = allThreats(threats, x, y);
    const better =
      clearance !== bestClearance
        ? clearance > bestClearance
        : total !== bestTotal
          ? total > bestTotal
          : best !== here && cell < best;
    if (better) {
      best = cell;
      bestClearance = clearance;
      bestTotal = total;
    }
  }
  return best;
}

/** Whether the run from `here` to `goal` should hold against the fresh aim `dest`: it heads the same way, or
 *  `goal` lies no nearer the nearest threat in `threatCells` than `dest` does. */
function runHolds(
  terrain: TerrainGraph,
  here: NodeId,
  goal: NodeId,
  dest: NodeId,
  threatCells: readonly NodeId[],
): boolean {
  const h = terrain.coordsOf(here);
  const g = terrain.coordsOf(goal);
  const d = terrain.coordsOf(dest);
  if (
    dest !== here &&
    Math.sign(g.x - h.x) === Math.sign(d.x - h.x) &&
    Math.sign(g.y - h.y) === Math.sign(d.y - h.y)
  ) {
    return true;
  }
  const threats = threatCells.map((t) => terrain.coordsOf(t));
  return nearestThreat(threats, g.x, g.y) >= nearestThreat(threats, d.x, d.y);
}

type NodeCoords = { readonly x: number; readonly y: number };

/** The map-point distance from node (x, y) to the nearest of `threats`, as the threat search measures. */
function nearestThreat(threats: readonly NodeCoords[], x: number, y: number): number {
  let min = Number.POSITIVE_INFINITY;
  for (const t of threats) min = Math.min(min, hexDistanceBetween(x, y, t.x, t.y));
  return min;
}

/** The summed map-point distance from node (x, y) to every one of `threats`. */
function allThreats(threats: readonly NodeCoords[], x: number, y: number): number {
  let sum = 0;
  for (const t of threats) sum += hexDistanceBetween(x, y, t.x, t.y);
  return sum;
}

/** Whether a settler's hunger or fatigue has reached the {@link NEED_COLLAPSE_THRESHOLD}, at which it stops
 *  to eat or sleep even in danger. */
function needCollapsing(world: World, tick: number, e: Entity): boolean {
  const s = world.get(e, SettlerNeeds);
  return (
    needLevel(s, 'hunger', tick) >= NEED_COLLAPSE_THRESHOLD ||
    needLevel(s, 'fatigue', tick) >= NEED_COLLAPSE_THRESHOLD
  );
}
