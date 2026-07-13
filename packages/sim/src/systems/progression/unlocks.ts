import type { JobRequirement, JobRequirementTarget, VehicleType } from '@open-northland/data';
import { Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isShipVehicle } from '../readviews/vehicles.js';

/**
 * The *gating* half of progression — is a building of `buildingType` unlocked for `tribe` right now?
 *
 * In Cultures, a tribe can't build everything from the start: a house is *enabled* once a settler of
 * the right job is present in the tribe (`tribetypes` `jobEnablesHouse <jobType> <houseType>`). E.g.
 * a smithy might be gated on a smith existing, a barracks on a soldier. This is the read side of the
 * `jobEnables` edges the pipeline's `extractJobEnables` produces: a building is enabled when either
 *  - **no** `jobEnablesHouse` edge in the tribe's tech-graph gates that `buildingType` (it is an
 *    ungated start building, like the headquarters), OR
 *  - a settler of **any** of the jobs whose edge gates it is currently alive in that tribe.
 *
 * Determinism: this is a pure **membership** query (does *some* enabling-job settler exist?), so the
 * `query` insertion-order traversal is fine — the boolean is order-independent (like `Map.has`, which
 * the determinism contract permits). No RNG, no wall-clock; content arrays are fixed at load. The
 * tribe id is matched on the `TribeType` `typeId`, the same id `Settler.tribe`/`Building.tribe`
 * carry. A tribe absent from content (bad input) gates nothing — every building stays enabled, so a
 * map with no tribe-type data still places its start buildings rather than silently rejecting them.
 */
export function buildingEnabled(
  world: World,
  ctx: SystemContext,
  tribe: number,
  buildingType: number,
): boolean {
  return tribeUnlockEnabled(world, ctx, tribe, 'house', buildingType);
}

/**
 * The *gating* half of progression for a **good** — is producing `goodType` unlocked for `tribe` right
 * now? The sibling of {@link buildingEnabled} on the `good` kind of the same `jobEnables` tech-graph:
 * the original's `tribetypes` `jobEnablesGood <jobType> <goodType>` edge means a settler of that job
 * being present unlocks producing the good. A good with **no** `jobEnablesGood` edge gating it is an
 * ungated start good (made freely); one that *is* gated may be produced only while an enabling-job
 * settler is alive in the same tribe.
 *
 * Consumed by ProductionSystem's cycle-start gate: a workplace can't begin a cycle whose output good
 * is gated-out (a tannery makes no leather until the tribe has the tanner that enables it). Same
 * determinism properties as {@link buildingEnabled} — a pure membership query, no RNG/wall-clock.
 */
export function goodEnabled(world: World, ctx: SystemContext, tribe: number, goodType: number): boolean {
  return tribeUnlockEnabled(world, ctx, tribe, 'good', goodType);
}

/**
 * The *gating* half of progression for a **job** — is `jobType` itself unlocked for `tribe` right now?
 * The fourth and last sibling of {@link buildingEnabled}/{@link goodEnabled} on the `jobEnables`
 * tech-graph (the `job` kind): the original's `tribetypes` `jobEnablesJob <jobType> <targetJob>` edge
 * means a settler of `jobType` being present unlocks the *target job* for the tribe — a specialization
 * a tribe can't staff until the prerequisite trade exists (e.g. a smith unlocking a weaponsmith). A job
 * with **no** `jobEnablesJob` edge gating it is an ungated start trade (anyone can take it); one that
 * *is* gated may be taken only while a settler of an enabling job is alive in the same tribe.
 *
 * Consumed by the JobSystem's assignment gate ({@link openJobAt}): an idle settler is offered a
 * workplace's worker job only while that job is unlocked, so the read side now covers all four
 * `jobEnables` kinds. Same determinism properties as {@link buildingEnabled} — a pure membership
 * query, no RNG/wall-clock.
 */
export function jobEnabled(world: World, ctx: SystemContext, tribe: number, jobType: number): boolean {
  return tribeUnlockEnabled(world, ctx, tribe, 'job', jobType);
}

/**
 * Shared read side of the `jobEnables` tech-graph for a single `(kind, targetId)`: is the target
 * unlocked for `tribe`? The target is enabled when either no edge of `kind` gates it (ungated), or a
 * settler of any gating job is currently alive in the tribe. {@link buildingEnabled} (kind `house`),
 * {@link goodEnabled} (kind `good`), {@link jobEnabled} (kind `job`), and {@link carrierCarryCapacity}
 * (kind `vehicle`) are the consumers — all four kinds are now read. Determinism: a pure membership
 * query (does *some* enabling-job settler exist?), order-independent like `Map.has`; a tribe absent
 * from content gates nothing.
 */
function tribeUnlockEnabled(
  world: World,
  ctx: SystemContext,
  tribe: number,
  kind: 'house' | 'good' | 'job' | 'vehicle',
  targetId: number,
): boolean {
  const tribeType = contentIndex(ctx.content).tribes.get(tribe);
  if (tribeType === undefined) return true; // no tech-graph for this tribe — nothing gates it

  // The jobs that unlock this target (a target may be gated by several different jobs).
  const enablingJobs = new Set<number>();
  for (const edge of tribeType.jobEnables) {
    if (edge.kind === kind && edge.targetId === targetId) enablingJobs.add(edge.jobType);
  }
  if (enablingJobs.size === 0) return true; // ungated target (e.g. the headquarters / a start good)

  // Enabled iff a settler of an enabling job is currently alive in this tribe.
  for (const e of world.query(Settler)) {
    const s = world.get(e, Settler);
    if (s.tribe === tribe && s.jobType !== null && enablingJobs.has(s.jobType)) return true;
  }
  return false;
}

/**
 * The carry batch a `tribe`'s carrier hauls in one swing: the largest `stockSlots` (vehicle carry
 * capacity, `vehicletypes`) among the vehicle types the tribe has currently UNLOCKED, or `1` (a
 * single unit carried on foot) when the tribe has unlocked no vehicle.
 *
 * This is the sim's first consumer of the `vehicle` kind of the `jobEnables` tech-graph — the
 * sibling of {@link buildingEnabled}/{@link goodEnabled} on the `vehicle` axis. A vehicle is
 * unlocked exactly like a house/good: when **no** `jobEnablesVehicle` edge gates its `typeId`
 * (an ungated start vehicle) OR a settler of any gating job is alive in the tribe. The capacity is
 * then the best `stockSlots` over the unlocked set — a carrier hauls with the biggest cart its
 * tribe can field (handcart 15 → oxcart 30, etc.), and falls back to the on-foot single unit before
 * any cart is available. The `vehicle` `targetId` keys into `VehicleType.typeId` (the distinct
 * `logicvehicletype` namespace), the same id the `jobEnablesVehicle` edge resolved against.
 *
 * source-basis: the *capacity numbers* are the extracted `stockSlots` param and the *unlock* is the
 * extracted `jobEnablesVehicle` edge — both pinned to data. What is APPROXIMATED (see
 * source basis) is the carrier→vehicle PAIRING: the original assigns a specific vehicle per
 * haul, and a carrier visibly fetches/parks a cart; here a carrier abstractly hauls at its tribe's
 * best unlocked capacity (no per-carrier vehicle entity yet). The slice's point is to consume the
 * `stockSlots`/`vehicle`-edge data, not to model cart logistics — that is a later vehicle-entity slice.
 *
 * Determinism: a pure read over content (vehicles + the tribe's fixed-order `jobEnables`) and a
 * membership query over live settlers (order-independent, like {@link tribeUnlockEnabled}); the max
 * is associative/commutative so the scan order can't change the result. No RNG, no wall-clock.
 */
/** What a carrier hauls with no unlocked vehicle: one unit, carried on foot. */
const ON_FOOT_CARRY_CAPACITY = 1;

export function carrierCarryCapacity(world: World, ctx: SystemContext, tribe: number): number {
  let best = ON_FOOT_CARRY_CAPACITY; // the floor when the tribe has unlocked no vehicle
  for (const vehicle of ctx.content.vehicles) {
    if (vehicle.stockSlots <= best) continue; // can't beat the running best — skip the unlock check
    if (!tribeUnlockEnabled(world, ctx, tribe, 'vehicle', vehicle.typeId)) continue; // not unlocked yet
    best = vehicle.stockSlots;
  }
  return best;
}

/**
 * The **ship vehicle types a `tribe` has currently UNLOCKED** — the ships ({@link isShipVehicle}: the
 * `vehicle_ship` rows, `passengerSlots > 0`) whose `jobEnablesVehicle` tech-graph gate is satisfied for
 * the tribe right now, sorted ascending by `typeId`. This is the **ship-unlock tech gate** the plan
 * Phase-4 "Sea/Northland identity" item names as open: the content-only {@link shipVehicles} read view
 * answers *which vehicles are ships*; this answers the live-world question *which of those can THIS tribe
 * field yet* — the gate a boat-building/embark slice asks before it lets a tribe spawn a hull.
 *
 * It composes the two existing data-pinned halves with no new mechanic: the `passengerSlots`-based ship
 * classification ({@link isShipVehicle}) and the **same** `vehicle`-kind tech-graph gate
 * {@link carrierCarryCapacity} uses ({@link tribeUnlockEnabled}) — a ship is unlocked when **no**
 * `jobEnablesVehicle` edge gates its `typeId` (an ungated start ship) OR a settler of any gating job
 * (e.g. a shipwright) is alive in the tribe. A tribe absent from content gates nothing, so every ship is
 * unlocked (consistent with the carrier capacity / house / good gates).
 *
 * source-basis: pinned to data on both axes — the ship/cart split is the extracted `passengerslots` param
 * (see {@link isShipVehicle}) and the unlock is the extracted `jobEnablesVehicle` edge (the *Carrier*
 * row, source basis). It adds **no mechanic** (nothing embarks, no hull is spawned) — a derived
 * read over the already-extracted vehicle IR + the same membership query the capacity gate runs; the
 * boats-as-mobile-store ENTITIES and embark/disembark atomics stay deferred to the boat-entity slice.
 *
 * Determinism: a pure read over `content.vehicles` (filtered + explicitly **sorted** by `typeId`, so the
 * result order can't depend on declaration order) and the same order-independent live-settler membership
 * query {@link tribeUnlockEnabled} runs (a tribe-scoped `.has`). No RNG, no wall-clock.
 */
export function tribeShipsUnlocked(world: World, ctx: SystemContext, tribe: number): VehicleType[] {
  return ctx.content.vehicles
    .filter((v) => isShipVehicle(v) && tribeUnlockEnabled(world, ctx, tribe, 'vehicle', v.typeId))
    .sort((a, b) => a.typeId - b.typeId);
}

/**
 * The *threshold* half of progression — does a settler's accrued XP satisfy a single `needfor*`
 * requirement? This is the read side of the `{need,train}for{job,good}` table (`TribeType.jobRequirements`,
 * extracted by `extractJobRequirements`), consuming the same per-specialization XP `grantWorkExperience`
 * accrues onto `Settler.experience` (keyed by the `humanjobexperiencetypes` track typeId).
 *
 * A `needfor*` requirement says: to unlock the target, the settler must have already accrued `amount`
 * experience measured in the requirement's `experienceTypes` track(s). The settler's XP is keyed by the
 * **same** track typeIds, so the check sums the settler's accrued XP across the named tracks and compares
 * it to `amount`. A requirement with no `experienceTypes` (none observed in the real data, but the schema
 * permits an empty list) is vacuously met — there is no track to measure against.
 *
 * APPROXIMATED (see source basis): the original measures the threshold per the same below-the-`.ini`
 * XP logic the per-animation `event` deltas live in — whether a two-`expType` line means "sum both" or
 * "either alone" has no readable oracle. Summing the named tracks is the deterministic reading (a
 * single threshold over the relevant specializations); refine when the original's XP curve is observed.
 *
 * Only `requirement === 'need'` requirements are interpreted here — `train` requirements are a schooling
 * COST paid at a training house (the JobSystem/school slice), not an already-accrued XP threshold.
 * Determinism: a pure read over content + the settler's XP Map (summed in the requirement's fixed
 * `experienceTypes` order); no RNG, no wall-clock.
 */
export function experienceRequirementMet(
  experience: ReadonlyMap<number, number>,
  requirement: JobRequirement,
): boolean {
  if (requirement.requirement !== 'need') return true; // not an accrued-XP threshold (train = schooling)
  if (requirement.experienceTypes.length === 0) return true; // no track to measure against
  let accrued = 0;
  for (const expType of requirement.experienceTypes) accrued += experience.get(expType) ?? 0;
  return accrued >= requirement.amount;
}

/**
 * Does a settler meet **all** the `needfor*` XP thresholds gating a `(target, targetId)` for its tribe?
 *
 * The sibling of {@link tribeUnlockEnabled} on the *threshold* axis: where `jobEnables*` gates a target
 * on a job being PRESENT in the tribe, `needfor*` gates it on THIS settler having accrued enough XP. A
 * target with no `need` requirement is unthresholded (any settler clears it); one with several must clear
 * every one (e.g. a master baker needs both bread- and flour-track XP). `train` requirements are skipped
 * here — they are a schooling cost, not an accrued-XP threshold (see {@link experienceRequirementMet}).
 *
 * A tribe absent from content thresholds nothing (consistent with the `jobEnables` gate). Determinism:
 * a pure read over the tribe's `jobRequirements` (fixed source order) + the settler's XP Map.
 */
export function settlerMeetsNeed(
  ctx: SystemContext,
  tribe: number,
  target: JobRequirementTarget,
  targetId: number,
  experience: ReadonlyMap<number, number>,
): boolean {
  const tribeType = contentIndex(ctx.content).tribes.get(tribe);
  if (tribeType === undefined) return true; // no requirement table for this tribe — nothing thresholds it
  for (const req of tribeType.jobRequirements) {
    if (req.requirement !== 'need' || req.target !== target || req.targetId !== targetId) continue;
    if (!experienceRequirementMet(experience, req)) return false;
  }
  return true; // no unmet `need` requirement gates this target
}
