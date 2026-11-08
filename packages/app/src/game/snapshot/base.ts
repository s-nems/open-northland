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
import { entitiesOfIds, entitiesUnder, idsGroupedBy, idsGroupedByEach, idsWhere } from './id-index.js';

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

/** The good types a store marks as priority, ascending; none without a mark. */
export function storePriorityGoodsOf(e: SnapshotEntity): readonly number[] {
  const goods = (e.components.StorePriority as { goods?: unknown } | undefined)?.goods;
  return Array.isArray(goods) ? goods.filter((good): good is number => typeof good === 'number') : [];
}

/** The snapshot serializes `Fixed` as plain numbers; this reader restores the brand. */
export function positionOf(e: SnapshotEntity): { x: Fixed; y: Fixed } | undefined {
  const pos = e.components.Position as { x?: unknown; y?: unknown } | undefined;
  const x = num(pos?.x);
  const y = num(pos?.y);
  return x !== undefined && y !== undefined ? { x: x as Fixed, y: y as Fixed } : undefined;
}

/** Rider in vehicle, vehicle on ship, or settler resting in a house: the longest chain to a placed entity. A
 *  taken hauling cart is one step, to the carrier pulling it. */
const STANDING_CHAIN_DEPTH = 3;

/**
 * The entity that stands on the map for `id`: the entity itself while it has a position, else the
 * vehicle, ship or house it is inside, or the carrier pulling it. Undefined for an unknown id or a broken
 * chain.
 */
export function standingEntity(snapshot: WorldSnapshot, id: number): SnapshotEntity | undefined {
  let next: unknown = id;
  for (let depth = 0; depth <= STANDING_CHAIN_DEPTH && typeof next === 'number'; depth++) {
    const entity = entityById(snapshot, next);
    if (entity === undefined) return undefined;
    if (positionOf(entity) !== undefined) return entity;
    const c = entity.components;
    const vehicle = c.Vehicle as { carrier?: unknown; hauler?: unknown } | undefined;
    next =
      (c.Rider as { vehicle?: unknown } | undefined)?.vehicle ??
      vehicle?.carrier ??
      vehicle?.hauler ??
      (c.Resting as { at?: unknown } | undefined)?.at;
  }
  return undefined;
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

/** The match tick the lobby peace ends at while it holds, off the sim's `PeaceRules` singleton; null
 *  with no peace or once it ended. */
export function peaceHoldsUntilTickOf(snapshot: WorldSnapshot): number | null {
  const rules = entitiesWith(snapshot, 'PeaceRules')[0]?.components.PeaceRules as
    | { holds?: unknown; untilTick?: unknown }
    | undefined;
  return rules?.holds === true && typeof rules.untilTick === 'number' ? rules.untilTick : null;
}

/** Whether wells and hives may stand off grass: the sim's `BioGroundRules` waiver, off while absent. */
export function bioGroundRuleWaived(snapshot: WorldSnapshot): boolean {
  const rules = entitiesWith(snapshot, 'BioGroundRules')[0]?.components.BioGroundRules as
    | { waived?: unknown }
    | undefined;
  return rules?.waived === true;
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

/** The computer seats by their `AiControl` carriers, whatever their handlers are set to. */
const AI_SEATS = countedBy(
  (e) => num((e.components.AiControl as { player?: unknown } | undefined)?.player),
  'AI seats',
  { values: ['AiControl'] },
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

/** Whether a trader rides the ship pinned to its route. */
export function ridesPinnedShip(components: Readonly<Record<string, unknown>>): boolean {
  const pinned = num((components.TradeShip as { vehicle?: unknown } | undefined)?.vehicle);
  const rides = num((components.Rider as { vehicle?: unknown } | undefined)?.vehicle);
  return pinned !== undefined && pinned === rides;
}

/** The vehicle `e` commands and that stands on the map: the one its `Rider` names when `e` holds the
 *  commander seat, both have one owner, the vehicle rides no carrier and the rider is not aboard a moored ship (the sim's `commandedVehicleOf`). */
export function commandedVehicleOf(snapshot: WorldSnapshot, e: SnapshotEntity): number | undefined {
  const vehicle = num((e.components.Rider as { vehicle?: unknown } | undefined)?.vehicle);
  if (vehicle === undefined) return undefined;
  const self = entityById(snapshot, vehicle);
  if (self === undefined || vehicleCommanderOf(self) !== e.id || positionOf(self) === undefined)
    return undefined;
  if (ownerPlayerOf(self) !== ownerPlayerOf(e)) return undefined;
  const state = self.components.Vehicle as { carrier?: unknown; moored?: unknown };
  return state.carrier === null && (state.moored !== true || positionOf(e) !== undefined)
    ? vehicle
    : undefined;
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

const TRAINING_OCCUPANCY = countedBy(
  (e) => (trainingSeated(e) ? trainingHouseOf(e) : undefined),
  'training occupancy',
  { values: ['TrainingOrder'] },
);
const TRAINING_QUEUE = countedBy(
  (e) => (trainingSeated(e) ? undefined : trainingHouseOf(e)),
  'training queue',
  { values: ['TrainingOrder'] },
);

/** The seats taken at a school or barracks, learners still walking to it included. */
export function trainingOccupancyOf(snapshot: WorldSnapshot, house: number): number {
  return indexesOf(snapshot).get(TRAINING_OCCUPANCY).get(house) ?? 0;
}

/** The learners sent to a school or barracks that wait for a free seat. */
export function trainingQueueOf(snapshot: WorldSnapshot, house: number): number {
  return indexesOf(snapshot).get(TRAINING_QUEUE).get(house) ?? 0;
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

/** The houses a settler's `TradeRoute` names, in stop order, each once. */
export function tradeRouteHousesOf(e: SnapshotEntity): number[] {
  const route = e.components.TradeRoute as { stops?: unknown } | undefined;
  const houses: number[] = [];
  if (!Array.isArray(route?.stops)) return houses;
  for (const stop of route.stops) {
    const house = num((stop as { house?: unknown }).house);
    if (house !== undefined && !houses.includes(house)) houses.push(house);
  }
  return houses;
}

const ROUTE_CALLERS = idsGroupedByEach((e) => (isSettler(e) ? tradeRouteHousesOf(e) : []), 'route callers', {
  values: ['TradeRoute'],
  presence: ['Settler'],
});

/** The settlers whose trade route has a stop at `house`, ascending by id, whoever owns them. */
export function routeCallersAt(snapshot: WorldSnapshot, house: number): readonly SnapshotEntity[] {
  return entitiesUnder(snapshot, ROUTE_CALLERS, house);
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

/** Composite trade keys: an owner times the span, plus a job type under it. */
const TRADE_KEY_SPAN = 1 << 16;

const SETTLERS_BY_OWNER_TRADE = idsGroupedBy(
  (e) => {
    const owner = isSettler(e) ? ownerPlayerOf(e) : undefined;
    const job = owner === undefined ? undefined : settlerJobType(e);
    return owner === undefined || job === undefined ? undefined : owner * TRADE_KEY_SPAN + job;
  },
  'settlers by owner and trade',
  { values: ['Owner', 'Settler'] },
);

/** The settlers of `player` whose current trade is `jobType`, ascending by id. */
export function settlersOfTrade(
  snapshot: WorldSnapshot,
  player: number,
  jobType: number,
): readonly SnapshotEntity[] {
  return entitiesUnder(snapshot, SETTLERS_BY_OWNER_TRADE, player * TRADE_KEY_SPAN + jobType);
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

/** The map-placed house record a building stands on the footprint of, when it has one of its own. */
export function buildingRecordOf(e: SnapshotEntity): string | undefined {
  const record = (e.components.Building as { record?: unknown } | undefined)?.record;
  return typeof record === 'string' ? record : undefined;
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

/** Whether the settler holds a post that takes a flag of its own (the sim's `postTakesHaulFlag`). */
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

/** The trades whose post takes a flag: a carrier collects around it, a collector, hunter or fisher works
 *  there. */
export type PostFlagTrade = 'carrier' | 'collector' | 'hunter' | 'fisher';

/** The trade of a settler whose post takes a flag, or null when its post takes none. */
export function postFlagTradeOf(
  content: ContentSet,
  snapshot: WorldSnapshot,
  e: SnapshotEntity,
): PostFlagTrade | null {
  if (!holdsHaulFlagPost(content, snapshot, e)) return null;
  const jobType = settlerJobType(e) ?? null;
  if (systems.isHunterJob(content, jobType)) return 'hunter';
  if (systems.isFisherJob(content, jobType)) return 'fisher';
  return systems.worksFieldFromPost(content, jobType) ? 'collector' : 'carrier';
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

/** The builder whose claim planted a wall or road site's work flag; undefined while no one has claimed
 *  it. */
export function siteClaimBuilderOf(e: SnapshotEntity): number | undefined {
  const site = (e.components.Palisade ?? e.components.RoadSite) as
    | { reservation?: { builder?: unknown } | null }
    | undefined;
  return num(site?.reservation?.builder);
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

/** Whether a settler sent to train holds a seat there; false while it waits in the house's queue. */
export function trainingSeated(e: SnapshotEntity): boolean {
  return (e.components.TrainingOrder as { seated?: unknown } | undefined)?.seated === true;
}

/** The barracks the assistant booked a recruit's drill at; undefined for a settler it did not send. */
export function assistantBarracksOf(e: SnapshotEntity): number | undefined {
  const booking = e.components.AssistantRecruit as { barracks?: unknown } | undefined;
  return num(booking?.barracks);
}

/** The half-cell node a lost settler's latest refused way led to; undefined while it is not lost or no
 *  single node was out of reach. */
export function lostGoalOf(e: SnapshotEntity): number | undefined {
  const lost = e.components.LostWay as { goal?: unknown } | undefined;
  return num(lost?.goal);
}

/** The flag a gatherer or fisher works from, or a carrier collects around. */
function flagBindingOf(e: SnapshotEntity): { flag?: unknown; radius?: unknown } | undefined {
  return (e.components.WorkFlag ?? e.components.HaulFlag) as { flag?: unknown; radius?: unknown } | undefined;
}

/** The flag entity a gatherer drops off at, or a carrier collects around. */
export function workFlagOf(e: SnapshotEntity): number | undefined {
  return num(flagBindingOf(e)?.flag);
}

/** The rally flag marker a finished barracks planted, or undefined while it keeps none. */
export function rallyFlagOf(e: SnapshotEntity): number | undefined {
  return num((e.components.RallyPoint as { flag?: unknown } | undefined)?.flag);
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

const FLAG_HOLDERS = idsGroupedBy(workFlagOf, 'flag holders', { values: ['WorkFlag', 'HaulFlag'] });

/**
 * The gatherer or carrier bound to work flag `flag`, restricted to one player or `'any'`. A flag stores no
 * back-reference, so the edge is inverted by an index; should two settlers name one flag, the highest id
 * holds it.
 */
export function flagHolderOf(
  snapshot: WorldSnapshot,
  flag: number,
  player: number | 'any',
): number | undefined {
  const holders = indexesOf(snapshot).get(FLAG_HOLDERS).get(flag);
  if (holders === undefined) return undefined;
  for (let i = holders.length - 1; i >= 0; i--) {
    const id = holders[i];
    if (id === undefined) continue;
    if (player === 'any') return id;
    const holder = entityById(snapshot, id);
    if (holder !== undefined && ownerPlayerOf(holder) === player) return id;
  }
  return undefined;
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
