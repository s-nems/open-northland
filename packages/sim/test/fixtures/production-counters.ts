import { Building, JobAssignment, ProductionCounters } from '../../src/components/index.js';
import { contentIndex } from '../../src/core/content-index.js';
import type { Entity } from '../../src/ecs/world.js';
import type { Simulation } from '../../src/index.js';
import { heldGatherGood } from '../../src/systems/economy/gather-goods.js';
import { ctxOf } from './context.js';

/**
 * Stamp the counters `setProductionGoods` leaves: every product of `worker`'s workplace outside `goods`
 * stopped, the listed ones unlimited. For a narrow system fixture that skips the command's guards; the
 * worker must already hold its {@link JobAssignment}.
 */
export function pinProducts(sim: Simulation, worker: Entity, goods: readonly number[], cursor = 0): void {
  const workplace = sim.world.get(worker, JobAssignment).workplace;
  const buildingType = sim.world.get(workplace, Building).buildingType;
  const products = contentIndex(sim.content).recipeByProductByBuilding.get(buildingType)?.keys() ?? [];
  const counters: [number, number][] = [...products]
    .filter((good) => !goods.includes(good))
    .sort((a, b) => a - b)
    .map((good) => [good, 0]);
  sim.world.add(worker, ProductionCounters, { counters, cursor });
}

/** The one good `gatherer`'s counters hold it to, or undefined while they leave it several or none. */
export function gatherPick(sim: Simulation, gatherer: Entity): number | undefined {
  return heldGatherGood(sim.world, ctxOf(sim), gatherer);
}
