import type { ProductionCycle } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { chargeMilitaryPiety } from '../../lifecycle/needs.js';
import type { WorkplaceOperators } from '../../stores/index.js';

/**
 * Apply one {@link chargeMilitaryPiety} step to one on-station operator per completed cycle whose product is
 * a military good, in canonical order and capped at the operators present. An unstaffed-by-design workplace
 * is a no-op, since its anonymous operator is no entity to charge.
 */
export function chargeMilitaryPietyCost(
  world: World,
  ctx: SystemContext,
  done: readonly ProductionCycle[],
  operators: WorkplaceOperators,
): void {
  if (operators.kind === 'unstaffed') return;
  const military = contentIndex(ctx.content).militaryGoods;
  const forged = done.filter((c) => military.has(c.goodType)).length;
  if (forged === 0) return;
  for (const op of operators.operators.slice(0, forged)) chargeMilitaryPiety(world, op);
}
