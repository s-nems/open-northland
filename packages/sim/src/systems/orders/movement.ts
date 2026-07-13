import {
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Fleeing,
  Health,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Stance,
  Weapon,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nearestUnblockedNode } from '../../nav/nearest.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { System, SystemContext } from '../context.js';
import { dynamicBlockOverlay } from '../footprint/index.js';
import { MILITARY_MODE } from '../readviews/index.js';

/**
 * The PLAYER-order handlers (`moveUnit` / `setJob`) + the {@link playerOrderSystem} that plays a move
 * order out as a **soft, timed override** — split out of command/ (the dispatcher + structure
 * placement) and spawn.ts (entity creation), so the "direct control the human exerts over its own
 * units" concern has its own home.
 *
 * These are the FIRST commands that target an EXISTING entity to steer it (not create/destroy one).
 * The design is faithful to *Cultures*: settlers are autonomous, so a move order does NOT seize a unit
 * permanently — it sends the unit somewhere, then hands it back to the economy AI. A worker resumes
 * its job the tick it arrives (zero dwell — the detour never parks it); a soldier HOLDS the spot a
 * while (position-holding is a military concept); and the needs drives (eat/sleep/pray) can pull
 * either away at any time (see {@link playerOrderSystem}). RTS-style box-select-and-move for
 * civilians is itself a deviation from the original's hand/profession control — recorded in
 * source basis.
 */

/**
 * How many ticks a CIVILIAN (non-combatant) unit STANDS at the ordered spot after arriving before the
 * economy AI re-tasks it. ZERO — a worker sent somewhere goes straight back to its job the tick it
 * arrives (the earlier 2.5 s dwell read as "kaze mu isc i przestaje pracowac": a gatherer parked at
 * the destination doing nothing). The hold is a SOLDIER concept (position-holding); a civilian's move
 * order is just a detour.
 */
export const MOVE_ORDER_HOLD_CIVILIAN = 0;
/**
 * How many ticks a COMBATANT (a unit carrying Health or a Weapon — a warrior) STANDS at the ordered
 * spot before the economy AI re-tasks it. Long — a warrior holds position far longer than a worker
 * (~15 s at 20 Hz), but its needs still preempt (it may wander off to eat/sleep). APPROXIMATED
 * (source basis "Player move-order dwell").
 */
export const MOVE_ORDER_HOLD_SOLDIER = 300;

/** A unit is a combatant (the longer hold) when it carries a Health pool or a wielded Weapon. */
function isCombatantUnit(world: World, e: Entity): boolean {
  return world.has(e, Health) || world.has(e, Weapon);
}

/**
 * Resolve a raw clicked node to a node the unit can actually STAND on. A click that lands on a
 * resource footprint (tree/stone/iron/gold), a building body, or an unwalkable tile (water/rock) has
 * no standable goal there — the pathfinder rejects an occupied or unwalkable goal outright, so the
 * order would fail and the unit would simply stand still (the reported bug: accidentally clicking a
 * tree stops the unit). Snap such a goal to the NEAREST walkable, unblocked node so the unit walks to
 * the edge of what was clicked instead of refusing the order. A standable click is returned untouched.
 *
 * Only STATIC blockers (resource + building footprints) and terrain are considered — transient unit
 * BODIES are deliberately ignored, so this stays consistent with the economy's exact node-coincidence
 * walks; re-aiming a goal off a standing unit is the routing surround rule's job, applied only to
 * colliders (see movement/routing.ts). The overlay is a membership VIEW ({@link dynamicBlockOverlay}),
 * so a box-select issuing one move order per selected unit never re-copies the resource overlay per
 * order.
 */
function reachableMoveGoal(world: World, ctx: SystemContext, terrain: TerrainGraph, clicked: NodeId): NodeId {
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  if (terrain.isWalkable(clicked) && !blocked.has(clicked)) return clicked; // standable — no snap
  return nearestUnblockedNode(terrain, clicked, blocked) ?? clicked;
}

/** Drop a player order and the nav state it drove, returning the unit to full autonomy. */
function clearPlayerOrder(world: World, e: Entity): void {
  world.remove(e, PlayerOrder);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
}

/**
 * Order one OWNED settler to walk to (x,y) — the RTS "go there" order. It drops whatever the unit was
 * doing (a mid-action atomic, a stale route, an old goal) so the order takes effect immediately, sets
 * a fresh {@link MoveGoal} (the existing pathfinding→movement pipeline carries it out), and stamps a
 * {@link PlayerOrder} soft timed override so the unit STANDS a while on arrival before the economy AI
 * reclaims it (see {@link playerOrderSystem}).
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale target, a
 * non-settler (a building/resource can't be walked), or a NEUTRAL entity with no {@link Owner} (only a
 * player-owned unit is orderable — wildlife isn't the player's to command). A mapless sim has no cells
 * to navigate, so the order is a no-op there too. The command carries no issuing-player yet, so it
 * doesn't verify WHICH player owns the unit — the app only issues orders for the human's own units;
 * the per-player check lands with lockstep (source basis).
 */
export function moveUnit(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'moveUnit' }>,
): void {
  const terrain = ctx.terrain;
  if (terrain === undefined) return; // mapless sim: no cells to navigate over
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Position) || !world.has(e, Owner)) return;

  const goal = reachableMoveGoal(world, ctx, terrain, terrain.nodeAtClamped(command.x, command.y));
  // The order is authoritative — cancel the unit's current action + any pending route request so it
  // obeys now, then set the new goal. (A non-interruptible-atomic exception is a deferred
  // refinement.) A live PathFollow is deliberately KEPT: the navigation planner sees a route whose
  // destination no longer matches the goal and re-routes the same tick, and the routing splice then
  // replaces the path while carrying the walker's momentum through the turn (movement inertia) —
  // dropping the path here made every redirect stop dead and re-accelerate from rest.
  world.remove(e, CurrentAtomic);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  // A move order SUPERSEDES combat: drop any auto-engagement and attack focus so the unit walks off and
  // holds instead of re-acquiring its target and fighting. Without this a soldier that was engaged keeps
  // its Engagement, the CombatSystem re-chases the enemy, and the order only ever moves it one step (the
  // reported bug). This is the same "the order is authoritative" principle applied above to the atomic +
  // route: an explicit player command overrides the autonomous drives (economy AND auto-combat).
  world.remove(e, Engagement);
  world.remove(e, AttackOrder);
  world.remove(e, Fleeing); // a move order supersedes the flee drive too (and its run gait)
  world.add(e, MoveGoal, { cell: goal });
  // A move order RELOCATES a DEFEND unit's post: the guard defends the spot it was sent to, not the
  // tile the stance was set on. Without the re-anchor, the arrived-hold combat pass (which lets an
  // ATTACK/DEFEND fighter keep its combat drive while holding) would march the guard straight back
  // to its OLD anchor the moment it found no enemy there.
  const stance = world.tryGet(e, Stance);
  if (stance !== undefined && stance.mode === MILITARY_MODE.DEFEND) stance.anchorCell = goal;
  const holdTicks = isCombatantUnit(world, e) ? MOVE_ORDER_HOLD_SOLDIER : MOVE_ORDER_HOLD_CIVILIAN;
  // expiresAt null = the hold hasn't started; playerOrderSystem begins it on arrival.
  world.add(e, PlayerOrder, { holdTicks, expiresAt: null });
}

/**
 * PlayerOrderSystem — plays a move order out as a **soft, timed override** and then hands the unit
 * back to the autonomous economy. It runs just before {@link aiSystem} so an expiring hold frees the
 * unit for re-tasking in the SAME tick (no idle stall).
 *
 * Per unit under a {@link PlayerOrder}, in priority order:
 *  1. **Route failed** (an unwalkable/off-map target): the order can never be fulfilled — abandon it
 *     and clear the dead nav state (a failed {@link PathRequest} is never retried, so without this the
 *     unit would freeze on it forever).
 *  2. **Acting** (a {@link CurrentAtomic} appeared): autonomy has taken over — a need drive fired
 *     during the hold (the economy branch is gated off by this order, so only a need could) — the unit
 *     "went off to do its own thing". Drop the order (leave the atomic running).
 *  3. **Travelling** (goal/request/path present): before arrival this is the order's own walk — keep
 *     it. AFTER the hold has begun (`expiresAt` set) a fresh path instead means a need is walking the
 *     unit away (e.g. to food) — drop the order.
 *  4. **Arrived & idle**: begin the hold on first arrival (`expiresAt = tick + holdTicks`), then when
 *     the tick reaches it, remove the order so {@link aiSystem} re-tasks the unit this tick.
 *
 * While the order stands, {@link aiSystem}'s ECONOMY branch skips the unit (it stays put) but its
 * NEEDS drives still run — the faithful "worker returns to work soon; warrior holds longer; either may
 * wander off to eat/sleep" behaviour. Determinism: pure reads of the unit's components + the tick
 * counter; no RNG, no wall-clock; no-op without a terrain graph (nothing to have been ordered over).
 */
export const playerOrderSystem: System = (world, ctx) => {
  if (ctx.terrain === undefined) return; // mapless sim: no orders were issuable
  for (const e of world.query(Settler, PlayerOrder)) {
    const order = world.get(e, PlayerOrder);

    if (world.tryGet(e, PathRequest)?.failed) {
      clearPlayerOrder(world, e); // target unreachable — return to autonomy
      continue;
    }
    if (world.has(e, CurrentAtomic)) {
      world.remove(e, PlayerOrder); // a need took over — went off to do its own thing
      continue;
    }
    if (world.has(e, MoveGoal) || world.has(e, PathRequest) || world.has(e, PathFollow)) {
      if (order.expiresAt !== null) world.remove(e, PlayerOrder); // a need walked it away mid-hold
      continue;
    }
    // Arrived and idle: run the hold. Not an else-if — a zero hold (a civilian) starts AND expires on
    // the arrival tick, so the economy re-tasks the unit the same tick it gets there (aiSystem runs
    // right after this system): the worker turns around and goes straight back to its job.
    if (order.expiresAt === null) order.expiresAt = ctx.tick + order.holdTicks;
    if (ctx.tick >= order.expiresAt) {
      world.remove(e, PlayerOrder); // hold done — economy resumes (aiSystem re-tasks this tick)
    }
  }
};
