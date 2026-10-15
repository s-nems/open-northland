import type { ContentSet } from '@open-northland/data';
import type { AiOrderOrigin } from '../../components/ai-order.js';
import {
  Age,
  AttackOrder,
  Building,
  ClaimAnimalOrder,
  Engagement,
  Fleeing,
  Health,
  HuntFocus,
  NeedOrder,
  OpenChestOrder,
  Owner,
  Palisade,
  PickupClaim,
  PlayerOrder,
  Position,
  removeCurrentAtomic,
  Settler,
  Stance,
  SupplyRun,
  Vehicle,
} from '../../components/index.js';
import type { Command } from '../../core/commands/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { clearNavState } from '../movement/nav-state.js';
import {
  defaultStance,
  isFighterJob,
  isMilitaryMode,
  keepsAnchor,
  MILITARY_MODE,
} from '../readviews/index.js';
import { recordAiOrder } from './ai-lifecycle.js';
import { isOrderableSettler, supersedeStandingOrders } from './guards.js';

/**
 * Stamp the default military stance on an owned settler. The anchor resets to null until
 * {@link anchorAtFeet} or an order sets one. The caller guarantees `e` is owned, and Stance stays owned-only.
 */
export function stampDefaultStance(
  world: World,
  content: ContentSet,
  e: Entity,
  jobType: number | null,
): void {
  world.add(e, Stance, { mode: defaultStance(world, content, e, jobType), anchorCell: null });
}

/** Anchor a fighter where a spawn or a new trade leaves it. Any other settler keeps its null anchor until
 *  an order sets one. */
export function anchorAtFeet(world: World, ctx: SystemContext, e: Entity): void {
  const at = world.tryGet(e, Position);
  if (ctx.terrain === undefined || at === undefined) return;
  if (!isFighterJob(ctx.content, world.get(e, Settler).jobType)) return;
  const n = nodeOfPosition(at.x, at.y);
  moveAnchor(world, ctx.content, e, ctx.terrain.nodeAtClamped(n.hx, n.hy));
}

/** Move `e`'s anchor to `cell` if its stance keeps one; any other stance keeps its null anchor. */
export function moveAnchor(world: World, content: ContentSet, e: Entity, cell: NodeId): void {
  const stance = world.tryGet(e, Stance);
  if (stance === undefined || stance.anchorCell === cell) return;
  if (keepsAnchor(content, stance.mode, world.get(e, Settler).jobType))
    world.mut(e, Stance).anchorCell = cell;
}

/**
 * Set one owned unit's military stance - see the command doc. `ATTACK` keeps a fighter's anchor, as the
 * original's mode change leaves the work centre alone, and captures the tile only where it had none.
 * `DEFEND` and `IGNORE` capture the unit's current tile, a deliberate deviation: the AI march holds its men
 * on their places by setting the stance there. Every other mode clears it.
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

  // A mapless sim leaves the anchor null, since a leash only means something where cells exist.
  const kept = command.mode === MILITARY_MODE.ATTACK ? (world.tryGet(e, Stance)?.anchorCell ?? null) : null;
  let anchorCell: NodeId | null = null;
  const anchored = keepsAnchor(ctx.content, command.mode, world.get(e, Settler).jobType);
  if (anchored && kept !== null) anchorCell = kept;
  else if (anchored && ctx.terrain !== undefined && world.has(e, Position)) {
    const p = world.get(e, Position);
    const n = nodeOfPosition(p.x, p.y);
    anchorCell = ctx.terrain.nodeAtClamped(n.hx, n.hy);
  }
  world.add(e, Stance, { mode: command.mode, anchorCell });
}

/**
 * Order one owned combatant to attack a specific `target`: an enemy unit, building or vehicle.
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
  origin?: AiOrderOrigin,
): void {
  if (ctx.terrain === undefined) return; // mapless sim: no cells to fight over
  const e = command.entity;
  if (!world.isAlive(e) || !world.has(e, Settler) || !world.has(e, Position)) return;
  if (!world.has(e, Owner) || !world.has(e, Health)) return; // only an owned combatant may be ordered to fight
  const target = command.target;
  if (world.has(target, Age)) return;
  if (target === e) return; // a unit can't attack itself
  if (!world.isAlive(target) || !world.has(target, Health) || !world.has(target, Position)) return;
  // A unit, a besiegeable building, a wall or a vehicle.
  if (
    !world.has(target, Settler) &&
    !world.has(target, Building) &&
    !world.has(target, Palisade) &&
    !world.has(target, Vehicle)
  ) {
    return;
  }

  // Unlike moveUnit and setJob this still cancels a non-interruptible atomic, a remaining member of that
  // class.
  removeCurrentAtomic(world, e);
  world.remove(e, SupplyRun); // cancel the inbound site claim
  world.remove(e, PickupClaim); // and the source promise of its pickup leg
  supersedeStandingOrders(world, e);
  clearNavState(world, e);
  world.remove(e, PlayerOrder);
  world.remove(e, Fleeing); // an explicit attack order overrides the flee mode - stop running, fight
  world.remove(e, HuntFocus); // and supersedes a hunter's self-committed prey, like a move order does
  world.remove(e, NeedOrder); // and an ordered meal, nap, chat or prayer
  world.remove(e, OpenChestOrder); // and a walk to a chest
  world.remove(e, ClaimAnimalOrder); // or after an animal
  world.add(e, AttackOrder, { target });
  // Original behavior: a fighter ordered onto a unit takes the node it stood on as its anchor. A building
  // or vehicle target leaves the anchor alone, its body standing on nodes nobody walks to.
  if (world.has(target, Settler) && isFighterJob(ctx.content, world.get(e, Settler).jobType)) {
    const at = world.get(target, Position);
    const n = nodeOfPosition(at.x, at.y);
    moveAnchor(world, ctx.content, e, ctx.terrain.nodeAtClamped(n.hx, n.hy));
  }
  // Stamped up front so plannerSystem skips economy for this unit on the tick the order lands rather than
  // leaking one tick; `repathAt = tick` makes the CombatSystem re-path the chase on its first pass.
  world.add(e, Engagement, { repathAt: ctx.tick });
  recordAiOrder(world, e, origin);
}
