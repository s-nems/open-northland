import type { JobRequirement, JobRequirementTarget, VehicleType } from '@open-northland/data';
import { Settler } from '../../components/index.js';
import { contentIndex } from '../../core/content-index.js';
import type { World } from '../../ecs/world.js';
import type { SystemContext } from '../context.js';
import { isShipVehicle } from '../readviews/vehicles.js';

/** Kill-switch for the building tech-unlock gate ({@link buildingEnabled}). Off pending a rework tied to
 *  the progression/experience system — see docs/tickets/sim/rework-building-unlock-gate.md. Annotated
 *  `boolean` (not narrowed to the literal) so both branches of the gate stay live for the type checker. */
const BUILDING_UNLOCK_GATE_ENABLED: boolean = false;

/**
 * The gating half of progression — is a building of `buildingType` unlocked for `tribe` right now?
 *
 * In Cultures, a tribe can't build everything from the start: a house is enabled once a settler of the right
 * job is present in the tribe (`tribetypes` `jobEnablesHouse <jobType> <houseType>`) — a smithy gated on a
 * smith existing, a barracks on a soldier. The read side of the `jobEnables` edges `extractJobEnables`
 * produces; see {@link tribeUnlockEnabled} for the shared rule.
 *
 * DISABLED: while {@link BUILDING_UNLOCK_GATE_ENABLED} is false this always returns true, so buildings
 * place, upgrade, staff, and get AI-targeted with no tech prerequisite — the whole `jobEnablesHouse`
 * gate is off until the rework re-enables it (the ticket above). It stays a live call at every gate site
 * so flipping the switch restores the behaviour with no code moves.
 */
export function buildingEnabled(
  world: World,
  ctx: SystemContext,
  tribe: number,
  buildingType: number,
): boolean {
  if (!BUILDING_UNLOCK_GATE_ENABLED) return true;
  return tribeUnlockEnabled(world, ctx, tribe, 'house', buildingType);
}

/**
 * Is producing `goodType` unlocked for `tribe` right now? The `good` kind of the same `jobEnables`
 * tech-graph: `jobEnablesGood <jobType> <goodType>` means a settler of that job being present unlocks the
 * good. Consumed by ProductionSystem's cycle-start gate — a tannery makes no leather until the tribe has the
 * tanner that enables it.
 */
export function goodEnabled(world: World, ctx: SystemContext, tribe: number, goodType: number): boolean {
  return tribeUnlockEnabled(world, ctx, tribe, 'good', goodType);
}

/**
 * Is `jobType` itself unlocked for `tribe` right now? The `job` kind of the tech-graph:
 * `jobEnablesJob <jobType> <targetJob>` means a settler of `jobType` unlocks the target job — a
 * specialization a tribe can't staff until the prerequisite trade exists (a smith unlocking a weaponsmith).
 * Consumed by the JobSystem's assignment gate ({@link openJobAt}).
 */
export function jobEnabled(world: World, ctx: SystemContext, tribe: number, jobType: number): boolean {
  return tribeUnlockEnabled(world, ctx, tribe, 'job', jobType);
}

/**
 * Shared read side of the `jobEnables` tech-graph for a single `(kind, targetId)`. The target is enabled when
 * either no edge of `kind` gates it (an ungated start target, like the headquarters), or a settler of any
 * gating job is currently alive in the tribe. A tribe absent from content gates nothing — every target stays
 * enabled, so a map with no tribe-type data still places its start buildings rather than silently rejecting
 * them. The tribe id matches the `TribeType` `typeId`, the same id `Settler.tribe`/`Building.tribe` carry.
 *
 * A pure membership query (does *some* enabling-job settler exist?), so the `query` insertion-order traversal
 * is order-independent and needs no canonical sort.
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

  for (const e of world.query(Settler)) {
    const s = world.get(e, Settler);
    if (s.tribe === tribe && s.jobType !== null && enablingJobs.has(s.jobType)) return true;
  }
  return false;
}

/**
 * The ship types a `tribe` has currently unlocked, sorted ascending by `typeId` so the result order can't
 * depend on `content.vehicles` declaration order. Where the content-only {@link shipVehicles} answers *which
 * vehicles are ships*, this answers *which of those this tribe can field yet* — the gate a
 * boat-building/embark slice asks before letting a tribe spawn a hull.
 *
 * Composes the `passengerSlots` ship classification ({@link isShipVehicle}) with the `vehicle`-kind
 * tech-graph gate ({@link tribeUnlockEnabled}): a ship is unlocked when no `jobEnablesVehicle` edge
 * gates its `typeId`, or a settler of a gating job (e.g. a shipwright) is alive in the tribe. Both axes are
 * pinned to extracted data; this adds no mechanic — nothing embarks and no hull is spawned.
 */
export function tribeShipsUnlocked(world: World, ctx: SystemContext, tribe: number): VehicleType[] {
  return ctx.content.vehicles
    .filter((v) => isShipVehicle(v) && tribeUnlockEnabled(world, ctx, tribe, 'vehicle', v.typeId))
    .sort((a, b) => a.typeId - b.typeId);
}

/**
 * The threshold half of progression — does a settler's accrued XP satisfy a single `needfor*` requirement?
 * The read side of the `{need,train}for{job,good}` table (`TribeType.jobRequirements`), consuming the
 * per-specialization XP `grantWorkExperience` accrues onto `Settler.experience` (keyed by the
 * `humanjobexperiencetypes` track typeId).
 *
 * A `needfor*` requirement demands `amount` experience measured in its `experienceTypes` track(s). Settler XP
 * is keyed by the same track typeIds, so the check sums the settler's XP across the named tracks and compares
 * to `amount`. A requirement with no `experienceTypes` (none in the real data, but the schema permits it) is
 * vacuously met. Only `requirement === 'need'` is interpreted here — `train` requirements are a schooling
 * cost paid at a training house, not an already-accrued threshold.
 *
 * source-basis (approximated): whether a two-`expType` line means "sum both" or "either alone" has no
 * readable oracle, since the original's threshold rides the same below-the-`.ini` XP logic the per-animation
 * `event` deltas live in. Summing the named tracks is the deterministic reading; refine when the original's
 * XP curve is observed.
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
 * Does a settler meet all the `needfor*` XP thresholds gating a `(target, targetId)` for its tribe?
 *
 * The sibling of {@link tribeUnlockEnabled} on the threshold axis: where `jobEnables*` gates a target on a
 * job being present in the tribe, `needfor*` gates it on this settler having accrued enough XP. A target with
 * no `need` requirement is unthresholded; one with several must clear every one (a master baker needs both
 * bread- and flour-track XP). A tribe absent from content thresholds nothing, consistent with the
 * `jobEnables` gate.
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
