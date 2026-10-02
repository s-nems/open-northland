import type { ContentSet } from '@open-northland/data';
import {
  components,
  countedBy,
  entitiesWith,
  entityById,
  type Fixed,
  groupedBy,
  indexesOf,
  type NeedDrain,
  type NeedLevels,
  ONE,
  type SettlerNeedsView,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { entitiesOfIds, entitiesUnder, idsGroupedBy, idsWhere } from './snapshot-id-index.js';

// Typed read helpers over the frozen WorldSnapshot, never over live component stores. Every read returns
// `undefined` for a missing component or field, because a snapshot entity carries only the components it
// has.

export type SnapshotEntity = WorldSnapshot['entities'][number];

export function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

export function ownerPlayerOf(e: SnapshotEntity): number | undefined {
  const owner = e.components.Owner as { player?: unknown } | undefined;
  return num(owner?.player);
}

/** The snapshot serializes `Fixed` as plain numbers; this reader restores the brand. */
export function positionOf(e: SnapshotEntity): { x: Fixed; y: Fixed } | undefined {
  const pos = e.components.Position as { x?: unknown; y?: unknown } | undefined;
  const x = num(pos?.x);
  const y = num(pos?.y);
  return x !== undefined && y !== undefined ? { x: x as Fixed, y: y as Fixed } : undefined;
}

export function healthOf(e: SnapshotEntity): { hitpoints: number; max: number } | undefined {
  const health = e.components.Health as { hitpoints?: unknown; max?: unknown } | undefined;
  const hitpoints = num(health?.hitpoints);
  const max = num(health?.max);
  return hitpoints !== undefined && max !== undefined ? { hitpoints, max } : undefined;
}

/**
 * Whether the experience tech tree gates this settler's trades and wares: the app mirror of the sim's
 * `experienceGatesApply`. The `ProgressionRules` toggle is a human-player setting, so an AI-owned
 * settler is never gated.
 */
export function progressionGatesSettler(snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  if (!progressionRuleEnabled(snapshot)) return false;
  const owner = ownerPlayerOf(e);
  return owner === undefined || !isComputerSeat(snapshot, owner);
}

/** Whether the needs mechanic runs, so a surface can drop what the rule has stopped moving. An absent
 *  `WorldRules` singleton means the sim default (enabled); the lowest-id carrier decides. */
export function needsRuleEnabled(snapshot: WorldSnapshot): boolean {
  const rules = entitiesWith(snapshot, 'WorldRules')[0]?.components.WorldRules as
    | { needsEnabled?: unknown }
    | undefined;
  return rules?.needsEnabled !== false;
}

/**
 * Whether `e` belongs to a computer seat. Its settlers raise no note and float no need bubble: original
 * behavior, the original drops every message a human of a computer-type player sends before it reaches the
 * player.
 */
export function ownedByComputerSeat(snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  const owner = ownerPlayerOf(e);
  return owner !== undefined && isComputerSeat(snapshot, owner);
}

/** The `ProgressionRules` singleton's toggle; an absent singleton means the sim default (enabled), and
 *  the lowest-id carrier decides. */
function progressionRuleEnabled(snapshot: WorldSnapshot): boolean {
  const rules = entitiesWith(snapshot, 'ProgressionRules')[0]?.components.ProgressionRules as
    | { professionProgressionEnabled?: unknown }
    | undefined;
  return rules?.professionProgressionEnabled !== false;
}

/** The computer seats by their `AiPlayer` carriers, whatever their handlers are set to. */
const AI_SEATS = countedBy(
  (e) => num((e.components.AiPlayer as { player?: unknown } | undefined)?.player),
  'AI seats',
  { values: ['AiPlayer'] },
);

function isComputerSeat(snapshot: WorldSnapshot, player: number): boolean {
  return indexesOf(snapshot).get(AI_SEATS).has(player);
}

/** The snapshot serializes `SettlerProgress.experience` as sorted `[spec, points]` pairs. Empty for a
 *  non-settler or a malformed field. */
export function settlerExperienceOf(components: Readonly<Record<string, unknown>>): Map<number, number> {
  const points = new Map<number, number>();
  const exp = (components.SettlerProgress as { experience?: unknown } | undefined)?.experience;
  if (!Array.isArray(exp)) return points;
  for (const pair of exp) {
    if (!Array.isArray(pair)) continue;
    const spec = num(pair[0]);
    const value = num(pair[1]);
    if (spec !== undefined && value !== undefined) points.set(spec, value);
  }
  return points;
}

export function isSettler(e: SnapshotEntity): boolean {
  return e.components.Settler !== undefined;
}
/** The settlers among `ids`, in the given order. */
export function settlersIn(snapshot: WorldSnapshot, ids: readonly number[]): SnapshotEntity[] {
  const settlers: SnapshotEntity[] = [];
  for (const id of ids) {
    const e = entityById(snapshot, id);
    if (e !== undefined && isSettler(e)) settlers.push(e);
  }
  return settlers;
}
export function isBuilding(e: SnapshotEntity): boolean {
  return e.components.Building !== undefined;
}
export function isVehicle(e: SnapshotEntity): boolean {
  return e.components.Vehicle !== undefined;
}
export function isSignpost(e: SnapshotEntity): boolean {
  return e.components.Signpost !== undefined;
}
export function isPalisade(e: SnapshotEntity): boolean {
  return e.components.Palisade !== undefined;
}

export function isRoadSite(e: SnapshotEntity): boolean {
  return e.components.RoadSite !== undefined;
}

/** The commander's seat is the last passenger slot; a free slot there reads as no commander. */
export function vehicleCommanderOf(e: SnapshotEntity): number | undefined {
  const slots = (e.components.Vehicle as { passengers?: unknown } | undefined)?.passengers;
  if (!Array.isArray(slots) || slots.length === 0) return undefined;
  return num((slots[slots.length - 1] as { entity?: unknown } | null)?.entity);
}

/** One `Vehicle.passengers` or `Vehicle.vehicles` seat as the snapshot clones it. */
export interface VehicleSeatSnapshot {
  readonly entity: number;
  /** Aboard, rather than still walking to the door. */
  readonly inside: boolean;
}

/** The taken seats of a `Vehicle.passengers` or `Vehicle.vehicles` slot list, in slot order. */
export function vehicleSeatsOf(slots: unknown): VehicleSeatSnapshot[] {
  if (!Array.isArray(slots)) return [];
  const seats: VehicleSeatSnapshot[] = [];
  for (const seat of slots) {
    const entity = num((seat as { entity?: unknown } | null)?.entity);
    if (entity === undefined) continue;
    seats.push({ entity, inside: (seat as { inside?: unknown }).inside === true });
  }
  return seats;
}

/** The vehicle `e` commands and that stands on the map: the one its `Rider` names when `e` holds the
 *  commander seat, both have one owner and the vehicle rides no carrier (the sim's `commandedVehicleOf`). */
export function commandedVehicleOf(snapshot: WorldSnapshot, e: SnapshotEntity): number | undefined {
  const vehicle = num((e.components.Rider as { vehicle?: unknown } | undefined)?.vehicle);
  if (vehicle === undefined) return undefined;
  const self = entityById(snapshot, vehicle);
  if (self === undefined || vehicleCommanderOf(self) !== e.id || positionOf(self) === undefined)
    return undefined;
  if (ownerPlayerOf(self) !== ownerPlayerOf(e)) return undefined;
  const carrier = (self.components.Vehicle as { carrier?: unknown }).carrier;
  return carrier === null ? vehicle : undefined;
}

/** A settler or a building, the entities {@link actorsOf} lists. */
export function isActor(e: SnapshotEntity): boolean {
  return isSettler(e) || isBuilding(e);
}

/** The components {@link isActor} tests the presence of. */
export const ACTOR_PRESENCE = ['Settler', 'Building'] as const;

const ACTORS = idsWhere(isActor, 'actors', { presence: ACTOR_PRESENCE });

/** The ids of {@link actorsOf}, ascending, maintained per change on a mirror. */
export function actorIdsOf(snapshot: WorldSnapshot): readonly number[] {
  return indexesOf(snapshot).get(ACTORS);
}

/**
 * Every settler and building of a snapshot, as an ascending-id subsequence of its `entities`. Iterate it;
 * it is not a snapshot's own entity lane, so never hand it to `entityById`, whose binary search would miss
 * everything this filtered out.
 */
export function actorsOf(snapshot: WorldSnapshot): readonly SnapshotEntity[] {
  return entitiesOfIds(snapshot.entities, actorIdsOf(snapshot));
}

const TRAINING_OCCUPANCY = countedBy(trainingHouseOf, 'training occupancy', { values: ['TrainingOrder'] });

/** Includes reserved places for learners still walking to their school or barracks. */
export function trainingOccupancyOf(snapshot: WorldSnapshot, house: number): number {
  return indexesOf(snapshot).get(TRAINING_OCCUPANCY).get(house) ?? 0;
}

const NO_ENTITIES: readonly SnapshotEntity[] = [];

/** Held as entity objects, unlike the id groupings: the door badges read the staff of every building on
 *  screen each tick, which costs more resolved than kept current. */
const STAFF = groupedBy((e) => (isSettler(e) ? workplaceOf(e) : undefined), 'staff', {
  values: ['JobAssignment'],
  presence: ['Settler'],
});

/** The settlers employed at `building` (`JobAssignment.workplace`), ascending by id. */
export function staffOf(snapshot: WorldSnapshot, building: number): readonly SnapshotEntity[] {
  return indexesOf(snapshot).get(STAFF).get(building) ?? NO_ENTITIES;
}

const SITE_CREWS = idsGroupedBy(buildSiteOf, 'site crews', { values: ['SiteAssignment'] });

/** The entities assigned to build or repair `site` (`SiteAssignment.site`), pinned or not, ascending by
 *  id. */
export function siteCrewOf(snapshot: WorldSnapshot, site: number): readonly SnapshotEntity[] {
  return entitiesUnder(snapshot, SITE_CREWS, site);
}

const SUPPLY_RUNS = idsGroupedBy(
  (e) => (isSettler(e) ? num((e.components.SupplyRun as { site?: unknown } | undefined)?.site) : undefined),
  'supply runs',
  { values: ['SupplyRun'], presence: ['Settler'] },
);

/** The settlers whose `SupplyRun` names `site`, ascending by id, whether or not the errand is still
 *  under way. */
export function supplyRunsTo(snapshot: WorldSnapshot, site: number): readonly SnapshotEntity[] {
  return entitiesUnder(snapshot, SUPPLY_RUNS, site);
}

const SETTLERS_BY_OWNER = idsGroupedBy(
  (e) => (isSettler(e) ? ownerPlayerOf(e) : undefined),
  'settlers by owner',
  {
    values: ['Owner'],
    presence: ['Settler'],
  },
);

/** The settlers `player` owns, people and livestock alike, ascending by id. */
export function settlersOwnedBy(snapshot: WorldSnapshot, player: number): readonly SnapshotEntity[] {
  return entitiesUnder(snapshot, SETTLERS_BY_OWNER, player);
}

const SHELTERERS = idsGroupedBy((e) => (isSettler(e) ? shelterOf(e) : undefined), 'shelterers', {
  values: ['Sheltering'],
  presence: ['Settler'],
});

/** The settlers that claimed `building` as their shelter, en route or inside, ascending by id. */
export function shelterersOf(snapshot: WorldSnapshot, building: number): readonly SnapshotEntity[] {
  return entitiesUnder(snapshot, SHELTERERS, building);
}

export function buildingTypeOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { buildingType?: unknown } | undefined;
  return num(b?.buildingType);
}

export function buildingTribeOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { tribe?: unknown } | undefined;
  return num(b?.tribe);
}

/** Fixed-point construction progress, where `ONE` is finished. */
export function builtFractionOf(e: SnapshotEntity): number | undefined {
  const b = e.components.Building as { built?: unknown } | undefined;
  return num(b?.built);
}

/** A building that stands finished: its shell is complete and no construction is running on it. */
export function isFinishedBuilding(e: SnapshotEntity): boolean {
  if (!isBuilding(e) || e.components.UnderConstruction !== undefined) return false;
  const built = builtFractionOf(e);
  return built !== undefined && built >= ONE;
}

/** Undefined for a jobless settler, whose `jobType` is `null`, as well as for a non-settler. */
export function settlerJobType(e: SnapshotEntity): number | undefined {
  const s = e.components.Settler as { jobType?: unknown } | undefined;
  return num(s?.jobType);
}

/** The building entity a settler is employed at. */
export function workplaceOf(e: SnapshotEntity): number | undefined {
  const a = e.components.JobAssignment as { workplace?: unknown } | undefined;
  return num(a?.workplace);
}

/** Whether the settler is a carrier at a post that takes a pickup flag (the sim's `postTakesHaulFlag`). */
export function holdsHaulFlagPost(content: ContentSet, snapshot: WorldSnapshot, e: SnapshotEntity): boolean {
  const jobType = settlerJobType(e);
  const workplace = workplaceOf(e);
  const building = workplace === undefined ? undefined : entityById(snapshot, workplace);
  const buildingType = building === undefined ? undefined : buildingTypeOf(building);
  return (
    jobType !== undefined &&
    buildingType !== undefined &&
    systems.postTakesHaulFlag(content, jobType, buildingType)
  );
}

/** The unit's military mode, or undefined before the simulation has stamped one. */
export function stanceModeOf(e: SnapshotEntity): number | undefined {
  const stance = e.components.Stance as { mode?: unknown } | undefined;
  return num(stance?.mode);
}

/** The foundation or damaged building a builder is assigned to. */
export function buildSiteOf(e: SnapshotEntity): number | undefined {
  const a = e.components.SiteAssignment as { site?: unknown } | undefined;
  return num(a?.site);
}

/** The foundation or damaged building an `assignBuilder` order pinned a builder to - the one the player
 *  can take back. */
export function pinnedSiteOf(e: SnapshotEntity): number | undefined {
  const a = e.components.SiteAssignment as { site?: unknown; pinned?: unknown } | undefined;
  return a?.pinned === true ? num(a.site) : undefined;
}

/** Builders assigned to `siteId`, pinned or not. */
export function builderCrewSize(snapshot: WorldSnapshot, siteId: number): number {
  return indexesOf(snapshot).get(SITE_CREWS).get(siteId)?.length ?? 0;
}

/** Whether the sim takes a builder order on `building` from `builder`: a foundation or upgrade site always,
 *  a standing damaged building while its repair crew has room or already counts the builder. */
export function builderCrewHasRoom(
  snapshot: WorldSnapshot,
  building: SnapshotEntity,
  builder: SnapshotEntity,
): boolean {
  if (building.components.UnderConstruction !== undefined || buildSiteOf(builder) === building.id)
    return true;
  return builderCrewSize(snapshot, building.id) < systems.REPAIR_CREW_LIMIT;
}

/** Whether the settler still leaves what it is doing to answer a need, the original's regeneration flag. */
export function regeneratesInWorld(e: SnapshotEntity): boolean {
  return e.components.NoRegeneration === undefined;
}

/** A creature rather than a person: the {@link Settler} model covers both, only people carry `Person`. */
export function isWildlife(e: SnapshotEntity): boolean {
  return isSettler(e) && e.components.Person === undefined;
}

function hasMissionBehaviour(e: SnapshotEntity, bits: number): boolean {
  const behaviour = e.components.MissionBehaviour as { flags?: unknown } | undefined;
  return ((num(behaviour?.flags) ?? 0) & bits) !== 0;
}

/** False once a script puts the unit beyond its player's orders: the sim drops every order a player
 *  issues it, while its seat's AI keeps commanding it. */
export function isPlayerControllable(e: SnapshotEntity): boolean {
  return !hasMissionBehaviour(e, components.MISSION_BEHAVIOUR.NOT_CONTROLLABLE);
}

/** A script made the settler unharmable: the sim spares its pool every blow and bite. */
export function isInvulnerable(e: SnapshotEntity): boolean {
  return hasMissionBehaviour(e, components.MISSION_BEHAVIOUR.INVULNERABLE);
}

/** A script fixed the settler's trade: the sim refuses a profession change, a lesson and a drill. */
export function isJobLocked(e: SnapshotEntity): boolean {
  return hasMissionBehaviour(e, components.MISSION_BEHAVIOUR.JOB_LOCKED);
}

/** The training house a settler walks to or drills at. */
export function trainingHouseOf(e: SnapshotEntity): number | undefined {
  const order = e.components.TrainingOrder as { house?: unknown } | undefined;
  return num(order?.house);
}

/** The flag a gatherer or fisher works from, or a carrier collects around. */
function flagBindingOf(e: SnapshotEntity): { flag?: unknown; radius?: unknown } | undefined {
  return (e.components.WorkFlag ?? e.components.HaulFlag) as { flag?: unknown; radius?: unknown } | undefined;
}

/** The flag entity a gatherer drops off at, or a carrier collects around. */
export function workFlagOf(e: SnapshotEntity): number | undefined {
  return num(flagBindingOf(e)?.flag);
}

/** A work-area binding: the flag the settler works around and that area's radius in half-cell nodes. */
export function workAreaOf(e: SnapshotEntity): { flag: number; radius: number } | undefined {
  const wf = flagBindingOf(e);
  const flag = num(wf?.flag);
  const radius = num(wf?.radius);
  return flag !== undefined && radius !== undefined ? { flag, radius } : undefined;
}

export function settlerTribeOf(e: SnapshotEntity): number | undefined {
  const settler = e.components.Settler as { tribe?: unknown } | undefined;
  return num(settler?.tribe);
}

/** A settler's or building's owner as a key: a building houses and employs its owner's settlers of any
 *  tribe. */
export function ownerKeyOf(e: SnapshotEntity): string {
  return `${ownerPlayerOf(e)}`;
}

/** The settler's need deficits at `tick`, the snapshot's own, fixed-point 0..ONE where higher is worse. */
export function settlerNeedsOf(e: SnapshotEntity, tick: number): NeedLevels | undefined {
  const needs = storedNeedsOf(e);
  return needs === undefined ? undefined : systems.needLevels(needs, tick);
}

const NEED_DRAINS: readonly NeedDrain[] = ['none', 'body', 'all'];

/** The bars as the sim last stored them. Each sits on the same side of the sated, drive and critical
 *  levels and ONE as the current bar (the sim's band thresholds), so a reader without the tick may compare
 *  them against those levels and no others. */
export function storedNeedsOf(e: SnapshotEntity): SettlerNeedsView | undefined {
  const stored = e.components.SettlerNeeds as Partial<Record<keyof SettlerNeedsView, unknown>> | undefined;
  if (stored === undefined) return undefined;
  const hunger = num(stored.hunger);
  const fatigue = num(stored.fatigue);
  const piety = num(stored.piety);
  const enjoyment = num(stored.enjoyment);
  const asOf = num(stored.asOf);
  const drain = NEED_DRAINS.find((d) => d === stored.drain);
  if (
    hunger === undefined ||
    fatigue === undefined ||
    piety === undefined ||
    enjoyment === undefined ||
    asOf === undefined ||
    drain === undefined
  )
    return undefined;
  return {
    hunger: hunger as Fixed,
    fatigue: fatigue as Fixed,
    piety: piety as Fixed,
    enjoyment: enjoyment as Fixed,
    asOf,
    drain,
  };
}

/** A growing settler's age in whole years at `tick`, the snapshot's own; undefined for a grown one. */
export function childAgeYearsOf(e: SnapshotEntity, tick: number): number | undefined {
  const age = e.components.Age as { ticks?: unknown; asOf?: unknown } | undefined;
  const ticks = num(age?.ticks);
  if (ticks === undefined) return undefined;
  const asOf = num(age?.asOf) ?? null;
  return Math.floor(systems.ageTicksAt({ ticks, asOf }, tick) / systems.TICKS_PER_AGE_YEAR);
}

/** The need the player ordered the settler to answer, standing until the atomic that answers it lands. */
export function orderedNeedOf(e: SnapshotEntity): unknown {
  return (e.components.NeedOrder as { need?: unknown } | undefined)?.need;
}

/**
 * Map each work flag entity to the gatherer or carrier it belongs to, restricted to one player or `'any'`.
 * A flag stores no back-reference, so this scan is the only way to invert the edge; a settler binds to
 * exactly one flag, so the map is 1:1.
 */
export function gathererByFlag(snapshot: WorldSnapshot, player: number | 'any'): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of snapshot.entities) {
    if (player !== 'any' && ownerPlayerOf(e) !== player) continue;
    const flag = workFlagOf(e);
    if (flag !== undefined) out.set(flag, e.id);
  }
  return out;
}

/** The defence-mode building a settler has claimed, or undefined when it is not running for cover. */
export function shelterOf(e: SnapshotEntity): number | undefined {
  const claim = e.components.Sheltering as { shelter?: unknown } | undefined;
  return num(claim?.shelter);
}

/** How many settlers have claimed `building` as their shelter. Counts claimants whether en route or
 *  already inside, matching the sim's own capacity ledger, so the HUD cannot advertise room a runner
 *  already holds. */
export function shelterClaimCount(snapshot: WorldSnapshot, building: number): number {
  return indexesOf(snapshot).get(SHELTERERS).get(building)?.length ?? 0;
}

export function settlerLearnedOf(
  components: Readonly<Record<string, unknown>>,
  kind: 'job' | 'good',
): readonly number[] {
  const learned = (components.SettlerProgress as { learned?: { job?: unknown; good?: unknown } } | undefined)
    ?.learned;
  const ids = learned?.[kind];
  return Array.isArray(ids) ? ids.filter((id): id is number => typeof id === 'number') : [];
}
