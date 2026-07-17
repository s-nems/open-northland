import type { BuildingType } from '@open-northland/data';
import { Building, Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import { ONE } from '../../core/fixed.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';

// The housing/population read model — the ceiling a tribe grows into and the count it grows. Kept
// beside the store read models it shares (the home-upgrade capacity in ./capacity.ts reads
// {@link homeNextTier}).

/**
 * The **housing capacity** a `tribe` currently has: the sum of the `homeSize` of its placed, fully
 * **built** `home` buildings. This is the sim's first consumer of the extracted `homeSize` param
 * (the original `logichousetype` `logichomesize` — the population a residence shelters: home level
 * 00 → 1, ... level 04 → 5). A tribe-level read view (the HUD's population/housing readout mirrors
 * it); births themselves are gated per home by its family slots (`familiesOf`), not by this sum.
 *
 * Only a **built** residence counts (`built >= ONE`): a home still under construction shelters no
 * one yet (the slice places buildings already built, but the ConstructionSystem will start them at
 * `built = 0`, so the gate is forward-compatible). A `home`-kind building type with no `homeSize`
 * (none in the real data, but the schema defaults it to 0) contributes nothing.
 *
 * source-basis: the per-home capacity is the extracted `homeSize` param — faithful by construction; what
 * the capacity *gates* (births) is a later mechanic. Determinism: a pure sum over buildings (addition
 * commutes, so the `query` store order can't change the total — no canonical sort needed); no
 * RNG/wall-clock. A building whose type is absent from content contributes nothing.
 */
export function housingCapacity(world: World, ctx: SystemContext, tribe: number): number {
  let capacity = 0;
  for (const e of world.query(Building)) {
    const b = world.get(e, Building);
    if (b.tribe !== tribe || b.built < ONE) continue; // wrong tribe, or not yet built — shelters no one
    const type = contentIndex(ctx.content).buildings.get(b.buildingType);
    if (type === undefined || type.kind !== 'home') continue; // not a residence
    capacity += type.homeSize;
  }
  return capacity;
}

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
 *
 * Cross-system: the ConstructionSystem uses it as the home level-up trigger (next tier's materials
 * present → upgrade), and {@link stockCapacity} uses it so a still-upgradable home advertises the next
 * tier's cost as carrier-delivery demand.
 */
export function homeNextTier(type: BuildingType, ctx: SystemContext): BuildingType | undefined {
  if (type.kind !== 'home') return undefined;
  const next = contentIndex(ctx.content).buildings.get(type.typeId + 1);
  return next?.kind === 'home' ? next : undefined;
}

/**
 * The current **population** of a `tribe`: the number of its living {@link Settler}s. The other half
 * of the housing read model ({@link housingCapacity} is the ceiling the HUD readout compares it to).
 * Counts every settler regardless of job (idle settlers are still mouths to house).
 *
 * Determinism: a pure count over `query(Settler)` (addition commutes — a count is order-independent,
 * so the store-order traversal is fine, like {@link presentOperatorCount}'s any-match); no RNG/wall-clock.
 */
export function tribePopulation(world: World, tribe: number): number {
  let count = 0;
  for (const e of world.query(Settler)) {
    if (world.get(e, Settler).tribe === tribe) count++;
  }
  return count;
}
