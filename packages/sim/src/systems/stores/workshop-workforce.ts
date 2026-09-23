import {
  Building,
  Carrying,
  CurrentAtomic,
  JobAssignment,
  MoveGoal,
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

/** A phase-local index: one worker scan, then only the requested workshop's crew and loads. */
export class WorkshopWorkforce {
  private readonly crews = new Map<Entity, Entity[]>();
  private readonly inbound = new Map<Entity, Map<number, number>>();

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
      const pickup = world.tryGet(e, CurrentAtomic)?.effect;
      const source = run?.source;
      const fetching =
        run?.site === destination &&
        source !== null &&
        source !== undefined &&
        (world.has(e, MoveGoal) || pickup?.kind === 'pickup' || pickup?.kind === 'draw') &&
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
      let goods = this.inbound.get(destination);
      if (goods === undefined) {
        goods = new Map();
        this.inbound.set(destination, goods);
      }
      goods.set(load.goodType, (goods.get(load.goodType) ?? 0) + load.amount);
    }
  }

  operatorsAt(workplace: Entity): readonly Entity[] {
    return this.crews.get(workplace) ?? [];
  }

  incomingOf(workplace: Entity, goodType: number): number {
    return this.inbound.get(workplace)?.get(goodType) ?? 0;
  }
}
