import { Building, JobAssignment, Position, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../../nav/terrain/index.js';
import type { SystemContext } from '../../context.js';
import { buildingProduces, lowestStockedGood } from '../../stores/index.js';
import { interactionCell, nearestByCell } from '../targets/index.js';
import type { SinkAvailability } from '../targets/stores/sinks.js';
import { isFarmCarrierHaulOutRole, isStorageSink } from './store-policy.js';

/**
 * The nearest **ground pile** a porter should collect from and the good to lift, or null if none is
 * within reach. A ground pile is a bare {@link Stockpile} on a positioned entity with **no
 * {@link Building}** (a loose heap dropped at a flag) holding at least one unit — the counterpart of
 * {@link nearestStoreFor}'s building-store sink. Nearest by Manhattan + ascending-cell-id (canonical
 * scan); within the chosen pile the good is its lowest-id stocked good ({@link stockpileEntries}, never
 * raw Map order). The porter then delivers the load through {@link deliveryTargetFor} to its warehouse.
 *
 * A pile is skipped when **no store can currently take its good** (every warehouse full for it): lifting it
 * would just make the porter hold a load it can't deposit, so instead it leaves that good on the ground and
 * collects the next DELIVERABLE pile — "the store is full of wood, so stop hauling wood and fetch something
 * else" (the same deliverability gate {@link nearestWorkplaceOutput} applies to workplace output). The
 * check is memoised per good — its deliverability is the same for every pile of that good in one scan.
 */
export function nearestGroundPile(
  candidates: readonly Entity[],
  sinks: SinkAvailability,
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph,
  here: NodeId,
): { pile: Entity; goodType: number } | null {
  const best = nearestByCell(terrain, candidates, here, (e) => {
    if (world.has(e, Building)) return null; // a building store isn't a loose ground pile
    if (!world.has(e, Stockpile) || !world.has(e, Position)) return null;
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) return null; // an empty pile is nothing to collect
    if (!sinks.has(good)) return null; // every store full for this good — leave it, try another good
    return interactionCell(world, ctx, terrain, e, here);
  });
  if (best === null) return null;
  const good = lowestStockedGood(world.get(best.entity, Stockpile)); // the winner's good (accept required one)
  return good === null ? null : { pile: best.entity, goodType: good };
}

/**
 * The finished OUTPUT good a carrier should haul OUT of the **producing building it is bound to**, to a
 * warehouse — or null when there is nothing to haul. This is the production half of the carrier rule
 * ("tragarz wbity w produkcję jednocześnie przynosi towary I odnosi do magazynu"): a carrier stationed at
 * a FARM (or any producing building) carries its finished output to central storage, where a carrier
 * stationed at a warehouse/HQ only brings goods IN.
 *
 * A candidate is a good the bound building's type PRODUCES ({@link buildingProduces}) that the building
 * currently stocks (>0) and that some STORAGE sink can take ({@link nearestStoreFor} with EVERY producer
 * of the good excluded — per-entity exclusion of only the own farm let two farms shuttle wheat between
 * each other forever). Walked in `produces` order (a fixed content array, so the pick never depends on
 * store insertion history), first haulable output wins.
 *
 * Scoped to a bound building whose produced good is **field-farmed** (a `farming` block —
 * {@link farmWorkGood}), the field loop's own data signal: a recipe workshop's finished output is already
 * hauled by the producer loop / carrier fallback ({@link workplaceOutputToHaul}/`nearestWorkplaceOutput`),
 * so this closes the gap only for the field producer (the farm) whose bound carrier was otherwise a pure
 * inbound porter. (Keying on "no recipe" instead would silently turn this off under real extracted
 * content — the pipeline synthesizes a recipe for every producing building.) Gated to a NON-field-worker,
 * mirroring the delivery twin: a FARMER falling through to the porter rung must never lift the farm's
 * wheat only to bank it straight back (a per-tick pickup/deposit ping-pong). Returns the bound home and
 * the good to lift, or null when there is nothing to haul.
 */
export function boundProducerOutputToHaul(
  sinks: SinkAvailability,
  world: World,
  ctx: SystemContext,
  settler: Entity,
  jobType: number,
  tribe: number,
): { home: Entity; goodType: number } | null {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return null;
  const home = binding.workplace;
  // Only a farm's CARRIER (same tribe, a field producer, not the field worker) hauls output out — the
  // role gate shared with `deliveryTargetFor` case 3, so pickup and delivery routing can't disagree.
  if (!isFarmCarrierHaulOutRole(world, ctx, home, jobType, tribe)) return null;
  if (!world.has(home, Stockpile) || !world.has(home, Position)) return null;
  const stock = world.get(home, Stockpile).amounts;
  for (const goodType of buildingProduces(world, ctx, home)) {
    if ((stock.get(goodType) ?? 0) <= 0) continue; // none of this output on hand
    if (sinks.has(goodType, /* excludeProducers */ true)) {
      return { home, goodType };
    }
  }
  return null;
}

/**
 * Whether a settler is a **porter**: bound (via {@link JobAssignment}) to a storage fixture rather than a
 * producing workplace — the gate for the ground-pile collection drive. A porter has no recipe workshop to
 * staff and (by content) no harvest atomic, so it exists to move loose goods into its store.
 */
export function isPorterBoundToStore(world: World, ctx: SystemContext, settler: Entity): boolean {
  const binding = world.tryGet(settler, JobAssignment);
  if (binding === undefined) return false;
  return isStorageSink(world, ctx, binding.workplace);
}
