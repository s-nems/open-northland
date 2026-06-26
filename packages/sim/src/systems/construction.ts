import { Building, Stockpile } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { ONE } from '../fixed.js';
import type { System, SystemContext } from './context.js';

/**
 * ConstructionSystem — an under-construction building becomes built once its material cost arrives.
 *
 * A building placed `underConstruction` (via {@link placeBuilding}) enters the world at `built = 0`
 * with an **empty** {@link Stockpile} (the construction site). Each tick, for every such building
 * (`built < ONE`):
 *
 *  - **Build-complete check:** if the site's own stockpile holds the building type's full
 *    `construction` material cost (every `{goodType, amount}` line in full), the materials are
 *    **consumed** (an explicit stockpile write — goods are conserved, the cost is spent into the
 *    structure) and the building flips to `built = ONE`, emitting `buildingFinished`. A building type
 *    with an **empty** `construction` cost (the headquarters, a free type) has its requirement
 *    trivially met, so it finishes on the first construction tick.
 *  - **Otherwise** (materials not yet all present): nothing happens — the site waits for more
 *    deliveries. WHO delivers the materials (a carrier hauling the `construction` goods to the site)
 *    is the existing transport/carrier path, deferred to a dispatch slice; this system is the
 *    build-completion half (materials present → consume → built), the construction analogue of the
 *    ProductionSystem's consume-inputs→deposit-outputs cycle.
 *
 * Once a building is `built >= ONE` it is finished forever — it is never revisited (production / housing
 * already gate on `built >= ONE`). The **home level-up** trigger (a built `home` consuming the next
 * tier's `construction` cost to upgrade `level` → a larger `homeSize`) is a separate follow-up; this
 * lands the place→deliver→build core.
 *
 * FIDELITY: the material cost is the extracted `construction` param (graphics-table
 * `LogicConstructionGoods`, docs/FIDELITY.md "Build-material cost") — faithful by construction; the
 * *behavior* (consume-when-all-present → flip built) is our design (the engine's build loop has no
 * oracle), recorded in docs/FIDELITY.md "ConstructionSystem". Determinism: no RNG, no wall-clock;
 * buildings are visited in the Building store's deterministic insertion order, the cost is read from
 * CONTENT, and every stockpile write goes through the canonical Map (never iterated for a decision).
 */
export const constructionSystem: System = (world, ctx) => {
  for (const e of world.query(Building, Stockpile)) {
    const building = world.get(e, Building);
    if (building.built >= ONE) continue; // already finished — never revisited

    const type = ctx.content.buildings.find((t) => t.typeId === building.buildingType);
    if (type === undefined) continue; // unknown type — can't price the build (shouldn't happen)
    if (!materialsPresent(world, e, type.construction)) continue; // still waiting on deliveries

    consumeMaterials(world, e, type.construction);
    building.built = ONE; // built — production / housing now count it
    ctx.events.emit({ kind: 'buildingFinished', entity: e });
  }
};

/** Whether the construction site's own stockpile holds every `construction` material in full. An
 *  empty cost (a free type) is trivially satisfied. */
function materialsPresent(
  world: World,
  building: Entity,
  cost: ReadonlyArray<{ goodType: number; amount: number }>,
): boolean {
  const stock = world.get(building, Stockpile).amounts;
  for (const line of cost) {
    if ((stock.get(line.goodType) ?? 0) < line.amount) return false;
  }
  return true;
}

/** Remove the `construction` materials from the site's stockpile (spent into the structure). The
 *  caller has verified via {@link materialsPresent} that every material is present in full, so a count
 *  can't go negative. A consumed good that hits zero is left as a 0 entry (the canonical Map tolerates
 *  it; the stockpile is never iterated for a decision). */
function consumeMaterials(
  world: World,
  building: Entity,
  cost: ReadonlyArray<{ goodType: number; amount: number }>,
): void {
  const stock = world.get(building, Stockpile).amounts;
  for (const line of cost) {
    const have = stock.get(line.goodType) ?? 0;
    stock.set(line.goodType, have - line.amount);
  }
}
