import {
  BuildingType,
  DEFAULT_RECIPE_TICKS,
  type GoodType,
  hasFieldFarmAtomics,
  type VehicleType,
} from '@open-northland/data';

/**
 * Temporarily strips the vehicle goods (handcart/oxcart/ships/catapult) from every building's `stock`
 * slots and `produces` list, so no workshop stores or crafts a vehicle as a ware. A vehicle good is a
 * `[goodtype]` whose id slug matches a `[logicvehicletype]`'s (the two tables share the debugname slugs).
 * Vehicles are not goods — the original builds them physically on a yard beside the workshop; restoring
 * them as yard-built vehicles is tracked in `docs/tickets/features/vehicle-yard-construction.md`. Runs
 * before {@link fillBuildingRecipes} so the recipe join never materializes a vehicle recipe.
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
 * Fills each producing building's `recipes` by the output-side join: a workplace's `produces` names the
 * output good(s) it makes, and a `[goodtype]`'s `productionInputGoods` (extracted onto
 * {@link GoodType.productionInputs}) names what producing that good consumes — so joining a building's
 * outputs through the goods table materializes the inputs the original house table never carried
 * directly. Cross-table, so it runs after `extractGoods`/`extractBuildings`, before `parseContentSet`.
 *
 * Returns new building records (the input array is left untouched). For each building with a non-empty
 * `produces`, one recipe per distinct produced good, in `produces` file order (the order the original
 * declares products; the HUD mirrors it):
 *   - `outputs` = that single good; amount = its `logicproduction` multiplicity (a repeated id sums;
 *     the table carries no per-good quantity, so uniform 1 is the faithful default). A field-farmed
 *     output ({@link hasFieldFarmAtomics}: wheat/herb/mushroom) is excluded — it is grown on the map,
 *     not made in-house — so a workplace producing only field goods (a farm) gets no recipes and the
 *     sim drives it through the field loop (`farmWorkGood`) instead.
 *   - `inputs` = that good's own `productionInputs`, in ascending goodType order (deterministic,
 *     source-order-independent) — a multi-product workshop pays only for the product it is crafting.
 *   - `ticks` = the uniform {@link DEFAULT_RECIPE_TICKS} design pacing (15 s at 1×); the extracted
 *     per-animation cycle lengths are deliberately not used (see the constant's doc).
 *
 * A building that already carries `recipes` (e.g. a future explicit override) is left as-is; one with
 * an empty `produces` is not a producer and is returned unchanged.
 */
export function fillBuildingRecipes(
  buildings: readonly BuildingType[],
  goods: readonly GoodType[],
): BuildingType[] {
  const goodById = new Map<number, GoodType>();
  for (const g of goods) goodById.set(g.typeId, g);

  return buildings.map((b) => {
    if (b.recipes.length > 0 || b.produces.length === 0) return b;

    const amounts = new Map<number, number>(); // distinct product → logicproduction multiplicity
    for (const outputGood of b.produces) {
      const good = goodById.get(outputGood);
      if (good !== undefined && hasFieldFarmAtomics(good)) continue;
      amounts.set(outputGood, (amounts.get(outputGood) ?? 0) + 1);
    }
    // Every declared output was field-grown → not a recipe workplace; leave it recipe-less.
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
