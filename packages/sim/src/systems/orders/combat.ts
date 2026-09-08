import type { ContentSet } from '@open-northland/data';
import {
  AttackOrder,
  Building,
  CurrentAtomic,
  DeferredOrder,
  Engagement,
  ExploreOrder,
  Fleeing,
  Health,
  HuntFocus,
  NeedOrder,
  Owner,
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
import { clearNavState } from '../movement/nav-state.js';
import { defaultStanceForJob, isMilitaryMode, MILITARY_MODE } from '../readviews/index.js';
import { isOrderableSettler } from './guards.js';

/**
 * Stamp the job-based default military stance on an owned settler. The anchor resets to null, since only
 * `setStance(DEFEND)` sets one. The caller guarantees `e` is owned, and Stance stays owned-only.
 */
export function stampDefaultStance(
  world: World,
  content: ContentSet,
  e: Entity,
  jobType: number | null,
): void {
  world.add(e, Stance, { mode: defaultStanceForJob(content, jobType), anchorCell: null });
}

/**
 * Set one owned unit's military stance - see the command doc. `DEFEND` captures the unit's current tile as
 * the anchor it guards and returns to; every other mode clears the anchor.
 *
 * The CombatSystem re-decides the unit's behavior from the new mode on its next pass, so this handler does
 * not cancel a running swing or an explicit {@link AttackOrder}.
 */
export function setStance(
  world: World,
  ctx: SystemContext,
  command: Extract<Command, { kind: 'setStance' }>,
): void {
  const e = command.entity;
  if (!isOrderableSettler(world, e)) return;
  if (!isMilitaryMode(command.mode)) return; // an out-of-range mode is bad input - skip

  // A mapless sim leaves the anchor null, since a DEFEND radius only means something where cells exist.
  let anchorCell: NodeId | null = null;
  if (command.mode === MILITARY_MODE.DEFEND && ctx.terrain !== undefined && world.has(e, Position)) {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    anchorCell = ctx.terrain.nodeAtClamped(n.hx, n.hy);
  }
  world.add(e, Stance, { mode: command.mode, anchorCell });
}

/**
 * Order one owned combatant to attack a specific `target`, which may be an enemy unit or an enemy building.
 * The {@link AttackOrder} focus makes the CombatSystem chase and strike regardless of sight radius; the
 * economy leaves an engaged unit alone, and a need is answered from what it carries or what its post holds
 * rather than by walking off the order. Like a move order it is authoritative and cancels the unit's current
 * action, route, and hold.
 *
 * Hostility is not checked here: the CombatSystem re-validates the target each tick and drops an order whose
 * target is or becomes friendly, so a stale order self-corrects deterministically.
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
  if (!world.isAlive(target) || !world.has(target, Health) || !world.has(target, Position)) return;
  if (!world.has(target, Settler) && !world.has(target, Building)) return; // a unit or a besiegeable building

  // Unlike moveUnit and setJob this still cancels a non-interruptible atomic, a remaining member of that
  // class.
  world.remove(e, CurrentAtomic);
  world.remove(e, DeferredOrder); // an attack order executing now supersedes any earlier parked order
  clearNavState(world, e);
  world.remove(e, PlayerOrder);
  world.remove(e, Fleeing); // an explicit attack order overrides the flee mode - stop running, fight
  world.remove(e, HuntFocus); // and supersedes a hunter's self-committed prey, like a move order does
  world.remove(e, NeedOrder); // and an ordered meal, nap, chat or prayer
  world.remove(e, ExploreOrder); // and a scout's sweep
  world.add(e, AttackOrder, { target });
  // Stamped up front so plannerSystem skips economy for this unit on the tick the order lands rather than
  // leaking one tick; `repathAt = tick` makes the CombatSystem re-path the chase on its first pass.
  world.add(e, Engagement, { repathAt: ctx.tick });
}
