import type { ProductionCycle, SettlerIdentity } from '../../../components/index.js';
import { Settler } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { chargeMilitaryPiety } from '../../lifecycle/needs/index.js';
import { atomicClipName, atomicEventChannelDelta } from '../../readviews/animations.js';
import { ATOMIC_EVENT_CHANNEL } from '../../readviews/index.js';
import type { WorkplaceOperators } from '../../stores/index.js';

/**
 * Charge each completed weapon or armour cycle to one on-station operator, in canonical order and capped
 * at the operators present. What it costs is the forge clip's own `event <at> 4 <delta>`, so a long sword
 * weighs twice a short one; an unstaffed-by-design workplace is a no-op, since its anonymous operator is no
 * entity to charge.
 *
 * Approximation: a craftsman runs no per-item atomic here, so the clip is read at the cycle the workplace
 * completes rather than at the frame the settler would have played.
 */
export function chargeMilitaryPietyCost(
  world: World,
  ctx: SystemContext,
  done: readonly ProductionCycle[],
  operators: WorkplaceOperators,
): void {
  if (operators.kind === 'unstaffed') return;
  const military = contentIndex(ctx.content).militaryGoods;
  const forged = done.filter((c) => military.has(c.goodType));
  if (forged.length === 0) return;
  for (const [i, op] of operators.operators.slice(0, forged.length).entries()) {
    const cycle = forged[i];
    if (cycle === undefined) continue;
    chargeMilitaryPiety(world, op, forgePietyUnits(world, ctx, op, cycle.goodType));
  }
}

/** What forging `goodType` costs its maker in piety: the `produce` clip's religion delta, 0 when the good
 *  or the operator's body binds none. */
function forgePietyUnits(world: World, ctx: SystemContext, operator: Entity, goodType: number): number {
  const produce = contentIndex(ctx.content).goods.get(goodType)?.atomics?.produce;
  const settler: SettlerIdentity | undefined = world.tryGet(operator, Settler);
  if (produce === undefined || settler === undefined) return 0;
  const clip = atomicClipName(ctx.content, settler, produce);
  return clip === undefined ? 0 : atomicEventChannelDelta(ctx.content, clip, ATOMIC_EVENT_CHANNEL.PIETY);
}
