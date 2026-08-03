import type { ProductionCycle } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { chargeMilitaryPiety } from '../../lifecycle/needs.js';
import type { WorkplaceOperators } from '../../stores/index.js';

/**
 * Charge each smith who finished forging this tick a fixed slice of piety. Forging a weapon or piece of
 * armor is the only thing that raises the piety deficit, and praying at a temple clears it. Applied once
 * per completed cycle whose product is a military good, to the operators on station in canonical order. An
 * unstaffed-by-design workplace is a no-op, since its anonymous operator is no entity to charge.
 * Authored: the piety cost has no original oracle.
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
  // One charge per completed military batch, one operator each, never more than were on station.
  for (const op of operators.operators.slice(0, forged)) chargeMilitaryPiety(world, op);
}
