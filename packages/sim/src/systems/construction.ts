import type { BuildingType } from '@vinland/data';
import { Building, Stockpile } from '../components/index.js';
import type { Entity, World } from '../ecs/world.js';
import { ONE } from '../fixed.js';
import type { System, SystemContext } from './context.js';

/**
 * ConstructionSystem — an under-construction building becomes built once its material cost arrives,
 * and a built `home` levels up once it accumulates the next tier's material cost.
 *
 * A building placed `underConstruction` (via {@link placeBuilding}) enters the world at `built = 0`
 * with an **empty** {@link Stockpile} (the construction site). Each tick, for every building:
 *
 *  - **Under construction (`built < ONE`):** if the site's own stockpile holds the building type's full
 *    `construction` material cost (every `{goodType, amount}` line in full), the materials are
 *    **consumed** (an explicit stockpile write — goods are conserved, the cost is spent into the
 *    structure) and the building flips to `built = ONE`, emitting `buildingFinished`. A building type
 *    with an **empty** `construction` cost (the headquarters, a free type) has its requirement
 *    trivially met, so it finishes on the first construction tick. Otherwise the site waits for more
 *    deliveries.
 *  - **A built `home` (`built >= ONE`, `kind === 'home'`):** if the next tier in the home **level
 *    chain** exists ({@link homeNextTier} — the level chain is the consecutive typeIds `home_level_00..04`
 *    = typeIds 2..6, so the next tier is `buildingType + 1` when that is also a `home`) and the home's
 *    own stockpile holds that next tier's full `construction` cost, the materials are **consumed** and
 *    the home **upgrades**: its `buildingType` becomes the next tier's typeId and its `level` increments,
 *    so its larger `homeSize` immediately raises `housingCapacity` (the births→housing loop gets more
 *    room). The top tier (`home_level_04`, no next typeId) has no upgrade. A non-home built building is
 *    finished forever — never revisited.
 *
 * WHO delivers the materials (a carrier hauling the `construction` goods to the site) is the existing
 * transport/carrier path: a `built < ONE` site advertises room for its outstanding materials via
 * `stockCapacity` so the carrier scan routes them there. A built home that can still upgrade does NOT
 * yet advertise its next tier's cost as delivery demand — accumulating the upgrade materials is a
 * future dispatch refinement; this lands the upgrade *trigger* (materials present → consume → level up).
 *
 * FIDELITY: the material cost is the extracted `construction` param (graphics-table
 * `LogicConstructionGoods`, docs/FIDELITY.md "Build-material cost") and the level chain is the extracted
 * typeId sequence — both faithful by construction; the *behaviors* (consume-when-all-present → flip
 * built / upgrade tier) are our design (the engine's build/upgrade loop has no oracle), recorded in
 * docs/FIDELITY.md "ConstructionSystem". Determinism: no RNG, no wall-clock; buildings are visited in
 * the Building store's deterministic insertion order, every decision reads CONTENT, and every stockpile
 * write goes through the canonical Map (never iterated for a decision). A newly-upgraded home is not
 * re-upgraded the same tick — `world.query` snapshots the matches and the new typeId's next-tier cost
 * isn't present (its materials were just spent).
 */
export const constructionSystem: System = (world, ctx) => {
  for (const e of world.query(Building, Stockpile)) {
    const building = world.get(e, Building);
    const type = ctx.content.buildings.find((t) => t.typeId === building.buildingType);
    if (type === undefined) continue; // unknown type — can't price the build (shouldn't happen)

    if (building.built < ONE) {
      if (!materialsPresent(world, e, type.construction)) continue; // still waiting on deliveries
      consumeMaterials(world, e, type.construction);
      building.built = ONE; // built — production / housing now count it
      ctx.events.emit({ kind: 'buildingFinished', entity: e });
      continue;
    }

    // A built building: only a `home` with a next tier can level up; every other built building (and a
    // maxed-out top-tier home) is finished forever.
    const next = homeNextTier(type, ctx);
    if (next === undefined) continue;
    if (!materialsPresent(world, e, next.construction)) continue; // upgrade materials not yet present

    consumeMaterials(world, e, next.construction);
    building.buildingType = next.typeId; // adopt the larger tier — homeSize/housingCapacity grow
    building.level += 1;
    ctx.events.emit({ kind: 'buildingUpgraded', entity: e, level: building.level });
  }
};

/**
 * The next tier in a `home`'s level chain, or undefined if `type` is not a `home` or is the top tier.
 *
 * The home level chain is the consecutive typeIds `home_level_00..04` (typeIds 2..6 in the real data),
 * each a distinct `home`-kind {@link BuildingType} carrying its OWN per-level `construction` cost and a
 * larger `homeSize`. So the next tier is the building type at `typeId + 1`, provided that type exists
 * AND is itself a `home` (the chain is contiguous; the type just past the chain's top, `home_level_04`,
 * is not a home, so a top-tier home has no next tier). Reading the chain off the consecutive typeId
 * keeps the upgrade purely data-driven — there is no separate "next level" pointer in the source; the
 * `home level NN` typeIds are sequential by construction.
 */
function homeNextTier(type: BuildingType, ctx: SystemContext): BuildingType | undefined {
  if (type.kind !== 'home') return undefined;
  const next = ctx.content.buildings.find((t) => t.typeId === type.typeId + 1);
  return next?.kind === 'home' ? next : undefined;
}

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
