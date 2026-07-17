import type { ProductionCycle } from '../../../components/index.js';
import { contentIndex } from '../../../core/content-index.js';
import type { World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { chargeMilitaryPiety } from '../../lifecycle/needs.js';
import type { WorkplaceOperators } from '../../stores/index.js';

/**
 * Charge each smith who finished forging this tick a fixed slice of piety — producing a weapon or piece of
 * armor is the only thing that raises the piety deficit (NeedsSystem no longer raises piety over time; praying
 * at a temple clears it). Applied once per completed cycle whose PRODUCT is a military good
 * ({@link import('../../../core/content-index.js').ContentIndex.militaryGoods} keyed on `cycle.goodType` — the
 * per-product batch model's one output), to the operators on station in canonical order (a lone-smith workshop
 * charges its one worker per sword). A non-military batch (a mill's flour) is a no-op, and so is an
 * unstaffed-by-design workplace — its anonymous operator is no entity to charge.
 * Source basis: design rule (user-specified).
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
  // One charge per completed military batch, one operator each (canonical order); never more than were
  // on station.
  for (const op of operators.operators.slice(0, forged)) chargeMilitaryPiety(world, op);
}
