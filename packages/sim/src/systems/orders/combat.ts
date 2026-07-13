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
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { defaultStanceForJob, isMilitaryMode, MILITARY_MODE } from '../readviews/index.js';

/**
 * Stamp the job-based **default military stance** on an owned settler (the
 * {@link import('../readviews/stances.js').defaultStanceForJob} lookup) — the single stamp point shared
 * by the spawn handler and the profession-change handler, so the default rule lives in one place. Resets
 * the anchor to null (only `setStance(DEFEND)` sets an anchor). The caller guarantees `e` is owned; the
 * Stance component stays owned-only so no unowned/golden entity ever carries one.
 */
export function stampDefaultStance(world: World, e: Entity, jobType: number | null): void {
  world.add(e, Stance, { mode: defaultStanceForJob(jobType), anchorCell: null });
}

/**
 * Set one OWNED unit's **military stance** (the `setStance` command) — the player's control over how a
 * unit reacts to enemies (the original's `MILITARY_MODE`). It writes the new `mode` onto the unit's
 * {@link Stance}; for `DEFEND` it also captures the unit's **current tile as the anchor** (the centre of
 * the defend radius / the tile it returns to when clear), and for every other mode it clears the anchor.
 * The CombatSystem re-decides the unit's behavior from the new mode on its next pass — it disengages an
 * IGNORE unit, starts a FLEE unit running when a threat is near, holds a DEFEND unit at its anchor — so
 * the handler itself only updates the mode; it does NOT force-cancel a running swing or an explicit
 * {@link AttackOrder} (an attack order intentionally overrides the stance, e.g. IGNORE + "attack that one").
 *
 * Recoverable bad input (skipped, still logged for faithful replay): a dead/stale target, a non-settler,
 * a NEUTRAL (unowned) entity — only a player's own unit has a military mode — or a `mode` outside the five
 * {@link MILITARY_MODE} ids. Mapless is fine (a DEFEND anchor is simply null with no cells). The command
 * carries no issuing-player yet; the per-player authority check lands with lockstep.
 */
export function setStance(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setStance' }>,
): void {
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Owner)) return;
  if (!isMilitaryMode(command.mode)) return; // an out-of-range mode is bad input — skip

  // A DEFEND stance anchors on the tile the unit stands on now (the centre it guards / returns to). Every
  // other mode carries no anchor. Mapless (no terrain) leaves the anchor null — DEFEND then behaves like a
  // radius around the unit's own cell only where cells exist.
  let anchorCell: NodeId | null = null;
  if (command.mode === MILITARY_MODE.DEFEND && ctx.terrain !== undefined && world.has(e, Position)) {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    anchorCell = ctx.terrain.nodeAtClamped(n.hx, n.hy);
  }
  world.add(e, Stance, { mode: command.mode, anchorCell });
}

/**
 * Order one OWNED combatant to ATTACK a specific `target` unit (the RTS "attack that one" — the combat
 * twin of {@link moveUnit}). It stamps an {@link AttackOrder} focus the CombatSystem reads: the unit
 * chases and strikes `target` **regardless of sight radius** until the target dies / stops being a valid
 * target (source basis — the soft-override philosophy of {@link moveUnit}: the economy leaves an
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
  world.remove(e, Fleeing); // an explicit attack order overrides the flee mode — stop running, fight
  world.add(e, AttackOrder, { target });
  // Stamp Engagement up front so aiSystem skips economy for this unit on the same tick the order lands;
  // repathAt = tick means the CombatSystem re-paths the chase on its first pass.
  world.add(e, Engagement, { repathAt: ctx.tick });
}
