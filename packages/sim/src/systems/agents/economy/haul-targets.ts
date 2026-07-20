import { Building, JobAssignment, Position, Stockpile } from '../../../components/index.js';
import type { Entity, World } from '../../../ecs/world.js';
import type { SystemContext } from '../../context.js';
import { buildingBlockedCells } from '../../footprint/index.js';
import { buildingProduces, lowestStockedGood } from '../../stores/index.js';
import type { PlannerContext } from '../planner-context.js';
import { buriedUnderBuilding, interactionCell, nearestByCell } from '../targets/index.js';
import { deliverableGoodProbe } from './routing.js';
import { isFarmCarrierHaulOutRole, isStorageSink } from './store-policy.js';

/**
 * The nearest **ground pile** a porter should collect from and the good to lift, or null if none is
 * within reach. A ground pile is a bare {@link Stockpile} on a positioned entity with **no
 * {@link Building}** (a loose heap dropped at a flag) holding at least one unit — the counterpart of
 * {@link nearestStoreFor}'s building-store sink. Nearest by Manhattan + ascending-cell-id (canonical
 * scan); within the chosen pile the good is its lowest-id stocked good ({@link stockpileEntries}, never
 * raw Map order). The porter then delivers the load through {@link deliveryTargetFor} to its warehouse.
 *
 * A pile is skipped when its good is currently **undeliverable for this porter** — `deliverable` is the
 * settler's own {@link deliverableGoodProbe} (the delivery rung's exact routing decision, signpost gate
 * included): lifting it would just make the porter hold a load it can't deposit and shed it at its feet,
 * so instead it leaves that good on the ground and collects the next deliverable pile — "the store is
 * full of wood, so stop hauling wood and fetch something else" (the same gate
 * {@link nearestWorkplaceOutput} applies to workplace output). A pile buried under a building's walls is
 * skipped too ({@link buriedUnderBuilding} — an unreachable stand would strand the porter).
 */
export function nearestGroundPile(
  plan: PlannerContext,
  opts: { readonly deliverable: (goodType: number, from?: Entity) => boolean },
): { pile: Entity; goodType: number } | null {
  const { world, ctx, terrain, here, targets } = plan;
  const { deliverable } = opts;
  const gate = plan.limit ?? undefined; // the porter's confinement — an out-of-area pile is not one it fetches
  const walls = buildingBlockedCells(world, ctx, terrain);
  const best = nearestByCell(terrain, targets.stockpiles, here, (e) => {
    if (world.has(e, Building)) return null; // a building store isn't a loose ground pile
    if (!world.has(e, Stockpile) || !world.has(e, Position)) return null;
    const good = lowestStockedGood(world.get(e, Stockpile));
    if (good === null) return null; // an empty pile is nothing to collect
    if (!deliverable(good, e)) return null; // no sink this porter can reach — leave it, try another good
    if (buriedUnderBuilding(world, terrain, walls, e)) return null; // walled in — an unreachable stand
    const cell = interactionCell(world, ctx, terrain, e, here);
    if (gate !== undefined && !gate.allowsNode(cell)) return null;
    return { cell, payload: good };
  });
  return best === null ? null : { pile: best.entity, goodType: best.payload };
}

/**
 * The finished OUTPUT good a carrier should haul OUT of the **producing building it is bound to**, to a
 * warehouse — or null when there is nothing to haul. This is the production half of the carrier rule
 * ("tragarz wbity w produkcję jednocześnie przynosi towary I odnosi do magazynu"): a carrier stationed at
 * a FARM (or any producing building) carries its finished output to central storage, where a carrier
 * stationed at a warehouse/HQ only brings goods IN.
 *
 * A candidate is a good the bound building's type PRODUCES ({@link buildingProduces}) that the building
 * currently stocks (>0) and that this carrier could actually deliver somewhere (`deliverable`, its
 * {@link deliverableGoodProbe} — the delivery rung's routing, producer-exclusion and signpost gate
 * included). Walked in `produces` order (a fixed content array, so the pick never depends on store
 * insertion history), first haulable output wins.
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
  deliverable: (goodType: number, from?: Entity) => boolean,
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
    if (deliverable(goodType, home)) {
      return { home, goodType };
    }
  }
  return null;
}

/**
 * The porter rung's whole pickup decision, side-effect-free: haul the bound producer's output out
 * ({@link boundProducerOutputToHaul}) or bring the nearest deliverable ground pile in
 * ({@link nearestGroundPile}), in that priority order — or null when the porter has nothing to do.
 * Split from `planPorter` (which acts on it) so the dormancy verifier can re-run the exact decision
 * without mutating state (see ./porter-dormancy.ts).
 */
export function porterPickupTarget(plan: PlannerContext): { from: Entity; goodType: number } | null {
  const deliverable = deliverableGoodProbe(plan);
  const haul = boundProducerOutputToHaul(
    deliverable,
    plan.world,
    plan.ctx,
    plan.entity,
    plan.jobType,
    plan.tribe,
  );
  if (haul !== null) return { from: haul.home, goodType: haul.goodType };
  const pile = nearestGroundPile(plan, { deliverable });
  return pile === null ? null : { from: pile.pile, goodType: pile.goodType };
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
