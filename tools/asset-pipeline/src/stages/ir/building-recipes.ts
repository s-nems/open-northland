import {
  BuildingType,
  DEFAULT_RECIPE_TICKS,
  type GoodType,
  hasFieldFarmAtomics,
  type TribeType,
  type VehicleType,
} from '@open-northland/data';

/**
 * Strips vehicle goods from every building's `stock` and `produces`, so no workshop stores or crafts a
 * vehicle as a ware: the original builds vehicles on a yard instead. A vehicle good is a `[goodtype]`
 * whose id slug matches a `[logicvehicletype]`'s, the slug both tables share. Runs before the recipe
 * join so no vehicle recipe is materialized.
 */
export function stripVehicleGoods(
  buildings: readonly BuildingType[],
  goods: readonly GoodType[],
  vehicles: readonly VehicleType[],
): BuildingType[] {
  const vehicleIds = new Set(vehicles.map((v) => v.id));
  const vehicleGoods = new Set(goods.filter((g) => vehicleIds.has(g.id)).map((g) => g.typeId));
  if (vehicleGoods.size === 0) return [...buildings];
  return buildings.map((b) => {
    const stock = b.stock.filter((s) => !vehicleGoods.has(s.goodType));
    const produces = b.produces.filter((g) => !vehicleGoods.has(g));
    if (stock.length === b.stock.length && produces.length === b.produces.length) return b;
    return BuildingType.parse({ ...b, stock, produces });
  });
}

/**
 * Materializes each producing building's `recipes` from its `produces` list, taking each recipe's inputs
 * from the output good's own `productionInputs`, which is the only place the source carries them. Inputs
 * are sorted by `goodType` so the result never depends on source order. A building that already carries
 * recipes, that produces only field-farmed goods, or that refills its own stock, is returned unchanged.
 *
 * A building whose worker jobs enable goods (`tribetypes.ini` `jobEnablesGood`) makes only those: the
 * original offers a worker the house's production list restricted to what its job enables, which leaves
 * the animal farm breeding sheep and cattle while its wool, leather and meat come from the slaughter
 * clip. A house whose workers enable nothing keeps its whole list.
 */
export function fillBuildingRecipes(
  buildings: readonly BuildingType[],
  goods: readonly GoodType[],
  tribes: readonly TribeType[],
): BuildingType[] {
  const goodById = new Map<number, GoodType>();
  for (const g of goods) goodById.set(g.typeId, g);
  const enabledByJob = goodsEnabledByJob(tribes);

  return buildings.map((b) => {
    if (b.recipes.length > 0 || b.produces.length === 0 || b.refillsOwnStock) return b;

    const enabled = new Set(b.workers.flatMap((w) => [...(enabledByJob.get(w.jobType) ?? [])]));
    const amounts = new Map<number, number>(); // distinct product → logicproduction multiplicity
    for (const outputGood of b.produces) {
      const good = goodById.get(outputGood);
      if (good !== undefined && hasFieldFarmAtomics(good)) continue;
      if (enabled.size > 0 && !enabled.has(outputGood)) continue;
      amounts.set(outputGood, (amounts.get(outputGood) ?? 0) + 1);
    }
    // Every declared output was field-grown or left to another job → not a recipe workplace.
    if (amounts.size === 0) return b;

    const recipes = [...amounts].map(([goodType, amount]) => ({
      inputs: [...(goodById.get(goodType)?.productionInputs ?? [])]
        .sort((x, y) => x.goodType - y.goodType)
        .map((i) => ({ ...i })),
      outputs: [{ goodType, amount }],
      ticks: DEFAULT_RECIPE_TICKS,
    }));
    return BuildingType.parse({ ...b, recipes });
  });
}

/** Job type → the goods its `jobEnablesGood` edges unlock, unioned over every tribe. */
function goodsEnabledByJob(tribes: readonly TribeType[]): ReadonlyMap<number, ReadonlySet<number>> {
  const byJob = new Map<number, Set<number>>();
  for (const tribe of tribes) {
    for (const edge of tribe.jobEnables) {
      if (edge.kind !== 'good') continue;
      let goods = byJob.get(edge.jobType);
      if (goods === undefined) {
        goods = new Set<number>();
        byJob.set(edge.jobType, goods);
      }
      goods.add(edge.targetId);
    }
  }
  return byJob;
}
