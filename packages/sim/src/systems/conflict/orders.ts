import { indexById } from '@vinland/data';
import {
  Age,
  AttackOrder,
  CurrentAtomic,
  Engagement,
  Health,
  JobAssignment,
  MoveGoal,
  Owner,
  PathFollow,
  PathRequest,
  PlayerOrder,
  Position,
  Settler,
  Weapon,
} from '../../components/index.js';
import type { Command } from '../../core/commands.js';
import type { Entity, World } from '../../ecs/world.js';
import type { System, SystemContext } from '../context.js';

/**
 * The PLAYER-order handlers (`moveUnit` / `setJob`) + the {@link playerOrderSystem} that plays a move
 * order out as a **soft, timed override** — split out of command.ts (the dispatcher + structure
 * placement) and spawn.ts (entity creation), so the "direct control the human exerts over its own
 * units" concern has its own home.
 *
 * These are the FIRST commands that target an EXISTING entity to steer it (not create/destroy one).
 * The design is faithful to *Cultures*: settlers are autonomous, so a move order does NOT seize a unit
 * permanently — it sends the unit somewhere, has it STAND a while, then hands it back to the economy
 * AI. A worker resumes its job quickly; a soldier stands longer; and the needs drives (eat/sleep/pray)
 * can pull either away at any time (see {@link playerOrderSystem}). RTS-style box-select-and-move for
 * civilians is itself a deviation from the original's hand/profession control — recorded in
 * docs/FIDELITY.md.
 */

/**
 * How many ticks a CIVILIAN (non-combatant) unit STANDS at the ordered spot after arriving before the
 * economy AI re-tasks it. Short — a blacksmith sent somewhere pauses briefly, then walks back to work.
 * APPROXIMATED (no oracle for the original's exact dwell): 50 ticks ≈ 2.5 s at 20 Hz (docs/FIDELITY.md
 * "Player move-order dwell"). A rise-driven need (hunger/fatigue/piety) can end the hold sooner.
 */
export const MOVE_ORDER_HOLD_CIVILIAN = 50;
/**
 * How many ticks a COMBATANT (a unit carrying Health or a Weapon — a warrior) STANDS at the ordered
 * spot before the economy AI re-tasks it. Long — a warrior holds position far longer than a worker
 * (~15 s at 20 Hz), but its needs still preempt (it may wander off to eat/sleep). APPROXIMATED
 * (docs/FIDELITY.md "Player move-order dwell").
 */
export const MOVE_ORDER_HOLD_SOLDIER = 300;

/** A unit is a combatant (the longer hold) when it carries a Health pool or a wielded Weapon. */
function isCombatantUnit(world: World, e: Entity): boolean {
  return world.has(e, Health) || world.has(e, Weapon);
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
 * the per-player check lands with lockstep (docs/FIDELITY.md).
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

  const goal = terrain.cellAtClamped(command.x, command.y);
  // The order is authoritative — cancel the unit's current action + any in-flight route so it obeys
  // now, then set the new goal. (A non-interruptible-atomic exception is a deferred refinement.)
  world.remove(e, CurrentAtomic);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
  world.add(e, MoveGoal, { cell: goal });
  const holdTicks = isCombatantUnit(world, e) ? MOVE_ORDER_HOLD_SOLDIER : MOVE_ORDER_HOLD_CIVILIAN;
  // expiresAt null = the hold hasn't started; playerOrderSystem begins it on arrival.
  world.add(e, PlayerOrder, { holdTicks, expiresAt: null });
}

/**
 * Change one OWNED settler's profession (the settler UI's "zmiana zawodu"): set its `Settler.jobType`
 * and reset it to a fresh idle worker of the new trade — drop the old workplace binding
 * ({@link JobAssignment}) so the JobSystem re-employs it at a building of the new job, cancel any
 * current action/route, and clear any {@link PlayerOrder} (a profession change hands the unit back to
 * the economy). The unit keeps any load it is carrying (it will still deposit it).
 *
 * Recoverable bad input (skipped, still logged): a dead/stale target, a non-settler, a NEUTRAL entity
 * (no {@link Owner}), an unknown `jobType` (absent from the jobs table), or a still-growing child (an
 * {@link Age} unit — its job class is the GrowthSystem's to set, not the player's).
 */
export function setJob(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setJob' }>,
): void {
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Owner)) return;
  if (world.has(e, Age)) return; // a growing child's job class is GrowthSystem's, not the player's
  if (indexById(ctx.content.jobs).get(command.jobType) === undefined) return; // unknown job — skip

  world.get(e, Settler).jobType = command.jobType;
  world.remove(e, JobAssignment); // re-employed at a building of the NEW job by the JobSystem
  world.remove(e, CurrentAtomic); // cancel whatever it was doing under the old job
  world.remove(e, PlayerOrder); // a profession change returns the unit to the economy
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
}

/**
 * Order one OWNED combatant to ATTACK a specific `target` unit (the RTS "attack that one" — the combat
 * twin of {@link moveUnit}). It stamps an {@link AttackOrder} focus the CombatSystem reads: the unit
 * chases and strikes `target` **regardless of sight radius** until the target dies / stops being a valid
 * target (docs/FIDELITY.md — the soft-override philosophy of {@link moveUnit}: the economy leaves an
 * engaged unit alone, but needs still preempt). Like a move order it is authoritative — it cancels the
 * unit's current action/route/hold so it obeys at once — and it also stamps the {@link Engagement} marker
 * up front so the AISystem skips economy planning for the unit from the very next tick (before the
 * CombatSystem's own pass re-stamps it), avoiding a one-tick economy leak.
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a mapless sim (no cells to fight
 * over); a dead/stale issuer, a non-settler, a NEUTRAL (unowned — wildlife isn't the player's to command)
 * or NON-combatant (no {@link Health}) issuer; a dead/stale/non-combatant target; or a self-target.
 * Hostility is NOT checked here — the CombatSystem re-validates {@link mayTarget} each tick and drops an
 * order whose target is (or becomes) friendly, so a stale/illegal order self-corrects deterministically.
 * The command carries no issuing-player yet; the per-player authority check lands with lockstep.
 */
export function attackUnit(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'attackUnit' }>,
): void {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to fight over
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Position)) return;
  if (!world.has(e, Owner) || !world.has(e, Health)) return; // only an owned combatant may be ordered to fight
  const target = command.target;
  if (target === e) return; // a unit can't attack itself
  if (!world.isAlive(target) || !world.has(target, Settler) || !world.has(target, Health)) return;
  if (!world.has(target, Position)) return;

  // The order is authoritative — cancel the unit's current action + any in-flight route/hold so it obeys
  // now (a non-interruptible-atomic exception is a deferred refinement, as with moveUnit).
  world.remove(e, CurrentAtomic);
  world.remove(e, MoveGoal);
  world.remove(e, PathRequest);
  world.remove(e, PathFollow);
  world.remove(e, PlayerOrder);
  world.add(e, AttackOrder, { target });
  // Stamp Engagement up front so aiSystem skips economy for this unit on the same tick the order lands;
  // repathAt = tick means the CombatSystem re-paths the chase on its first pass.
  world.add(e, Engagement, { repathAt: ctx.tick });
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
    // Arrived and idle: run the hold.
    if (order.expiresAt === null) {
      order.expiresAt = ctx.tick + order.holdTicks;
    } else if (ctx.tick >= order.expiresAt) {
      world.remove(e, PlayerOrder); // hold done — economy resumes (aiSystem re-tasks this tick)
    }
  }
};
