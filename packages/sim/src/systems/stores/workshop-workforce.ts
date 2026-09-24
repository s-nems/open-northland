import {
  Building,
  Carrying,
  JobAssignment,
  PathRequest,
  Settler,
  Stockpile,
  SupplyRun,
} from '../../components/index.js';
import { ONE } from '../../core/fixed.js';
import type { Entity, World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { anotherSystemOwns } from '../settlers/action-owner.js';
import { boundWorkplaceTarget } from '../settlers/targets/workplaces.js';
import { canonicalById } from '../spatial/nodes.js';
import { bankedSlot, stockCapacity } from './capacity.js';
import { accessibleStockAmounts } from './inventory.js';
import { isWorkplaceOperator } from './operators.js';
import { mergedRecipeOf, producesGoodWithoutInputs, recipeConsumes } from './workplace.js';

/** One settler's unit on its way to a workplace: carried, or on a pickup leg whose source still has it. */
export interface SupplyLoad {
  readonly settler: Entity;
  readonly goodType: number;
  readonly amount: number;
}

/** A phase-local index: one worker scan, then only the requested workshop's crew and loads. */
export class WorkshopWorkforce {
  private readonly crews = new Map<Entity, Entity[]>();
  private readonly inbound = new Map<Entity, SupplyLoad[]>();

  constructor(world: World, ctx: SystemContext) {
    for (const e of canonicalById(world.query(JobAssignment, Settler))) {
      if (anotherSystemOwns(world, e) || world.tryGet(e, PathRequest)?.failed === true) continue;
      const settler = world.get(e, Settler);
      if (settler.jobType === null) continue;
      const destination = boundWorkplaceTarget(world, ctx, e, settler.jobType, settler.tribe);
      if (destination === null) continue;
      if (isWorkplaceOperator(world, ctx, destination, settler.jobType)) {
        let crew = this.crews.get(destination);
        if (crew === undefined) {
          crew = [];
          this.crews.set(destination, crew);
        }
        crew.push(e);
      }
      const carried = world.tryGet(e, Carrying);
      const run = world.tryGet(e, SupplyRun);
      const source = run?.source;
      // A pickup leg counts on its arrival tick too, before the planner starts the pickup or draw there.
      const fetching =
        run?.site === destination &&
        source !== null &&
        source !== undefined &&
        ((accessibleStockAmounts(world, source)?.get(run.goodType) ?? 0) > 0 ||
          ((world.tryGet(source, Building)?.built ?? 0) >= ONE &&
            producesGoodWithoutInputs(world, ctx, source, run.goodType)));
      const load = carried ?? (fetching ? run : undefined);
      if (load === undefined) continue;
      if (!recipeConsumes(mergedRecipeOf(world, ctx, destination)?.inputs, load.goodType)) continue;
      if (bankedSlot(world, ctx, destination, load.goodType).goodType !== load.goodType) continue;
      if (
        stockCapacity(world, ctx, destination, load.goodType) <=
        (world.get(destination, Stockpile).amounts.get(load.goodType) ?? 0)
      )
        continue;
      let loads = this.inbound.get(destination);
      if (loads === undefined) {
        loads = [];
        this.inbound.set(destination, loads);
      }
      loads.push({ settler: e, goodType: load.goodType, amount: load.amount });
    }
  }

  operatorsAt(workplace: Entity): readonly Entity[] {
    return this.crews.get(workplace) ?? [];
  }

  /** Units of `goodType` the indexed loads bring to `workplace`, leaving out the settlers `skip` names. */
  incomingOf(workplace: Entity, goodType: number, skip?: (settler: Entity) => boolean): number {
    let units = 0;
    for (const load of this.inbound.get(workplace) ?? []) {
      if (load.goodType === goodType && skip?.(load.settler) !== true) units += load.amount;
    }
    return units;
  }
}
