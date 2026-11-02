import { entityById, systems } from '@open-northland/sim';
import {
  buildingTypeOf,
  isAdult,
  isFemale,
  num,
  residenceHomeOf,
  settlerJobType,
  vehicleSeatsOf,
  workplaceOf,
} from '../../../game/snapshot/index.js';
import type { Tile } from '../../picking.js';
import { homeHasFamilyRoom, staffingOf } from '../highlights/index.js';
import { schoolStudents } from '../panels/school-dialog.js';
import type { BuildingIntent, BuildingWorker } from '../right-click/building-rungs.js';
import { contentLookups, type RightClickContext } from '../right-click/context.js';
import {
  type PastShipPinPlan,
  type RightClickInput,
  type RightClickOrders,
  resolvePastShipPin,
  resolveRightClick,
} from '../right-click/press.js';
import type { RiderPlan } from '../right-click/riders.js';
import type { SettlerGroup } from '../right-click/settler-ladder.js';
import { isShip, type VehicleGroup, type VehiclePlan } from '../right-click/vehicles.js';

/** The verb a right click's main order is named by. */
export type HintAction =
  | 'walk'
  | 'drive'
  | 'sail'
  | 'moor'
  | 'moorAndLand'
  | 'attack'
  | 'attackMove'
  | 'hunt'
  | 'claim'
  | 'openChest'
  | 'eat'
  | 'putOn'
  | 'gather'
  | 'addToRoute'
  | 'removeFromRoute'
  | 'learn'
  | 'train'
  | 'work'
  | 'live'
  | 'build'
  | 'repair'
  | 'board'
  | 'loadAboard'
  | 'pinShip'
  | 'unpinShip'
  | 'workArea'
  | 'placeSignpost'
  | 'bombard';

/** Why a right click or an armed pick's press would do nothing or be refused, each exactly as the sim or
 *  the pick enforces it. */
export type HintRefusal =
  | 'tooManyUnits'
  | 'noFreePlaces'
  | 'noRoom'
  | 'cannotAddToRoute'
  | 'cannotWorkHere'
  | 'cannotLiveHere'
  | 'cannotBuildHere'
  | 'cannotTrainHere'
  | 'cannotBoard'
  | 'cannotLoadAboard'
  | 'cannotPinShip'
  | 'cannotMoorHere'
  | 'cannotPlaceSignpost';

/** The thing an order aims at, whose name the label puts before the verb. */
export type HintTarget =
  | { readonly kind: 'creature'; readonly ref: number }
  | { readonly kind: 'pile'; readonly ref: number }
  | { readonly kind: 'chest'; readonly ref: number }
  | { readonly kind: 'resource'; readonly ref: number };

export type PlanHint =
  | {
      readonly tone: 'action';
      readonly action: HintAction;
      /** The trade a workplace order gives every worker it seats, when it changes someone's. */
      readonly job: number | null;
      readonly target: HintTarget | null;
    }
  | { readonly tone: 'refusal'; readonly refusal: HintRefusal };

/**
 * The sim's last answers the hint reads synchronously; undefined while one has not landed, which
 * leaves the action optimistic. A click never orders on them: it awaits the host's answer.
 */
export interface HintAnswers {
  readonly tradeHouseAttach: (trader: number, house: number) => boolean | undefined;
  readonly vehicleAttach: (settler: number, vehicle: number) => boolean | undefined;
  readonly tradeShipPin: (trader: number, ship: number) => boolean | undefined;
  readonly jobChoice: (entity: number, jobType: number) => boolean | undefined;
  /** Whether a right click there moors any of `ships` at the shore, as the berth preview reads it. */
  readonly docks: (ships: readonly number[], tile: Tile) => boolean;
}

export interface HintContext extends RightClickContext {
  readonly answers: HintAnswers;
}

/** One order of the plan with the units it moves; the main one is the largest, the ladder breaking ties. */
interface Part {
  readonly count: number;
  readonly hint: PlanHint;
}

const action = (verb: HintAction, target: HintTarget | null = null, job: number | null = null): PlanHint => ({
  tone: 'action',
  action: verb,
  job,
  target,
});
const refusal = (reason: HintRefusal): PlanHint => ({ tone: 'refusal', refusal: reason });

/**
 * What the right click this input resolves to would do, named by its main order, or null where it
 * names nothing: an own settler under the cursor is selected, and a selection that takes no orders has
 * none. Resolved by the click's own resolver, so the label never disagrees with the press.
 */
export function planHint(ctx: HintContext, input: RightClickInput): PlanHint | null {
  const plan = resolveRightClick(ctx, input);
  switch (plan.kind) {
    case 'workFlag':
      return plan.units.length === 0 ? null : action('workArea');
    case 'doorSettler':
      return null;
    case 'orderLimit':
      return refusal('tooManyUnits');
    case 'pinShip': {
      const { trader, ship, unpins } = plan.pin;
      if (unpins) return action('unpinShip');
      if (ctx.answers.tradeShipPin(trader, ship) !== false) return action('pinShip');
      return pastShipPinHint(ctx, resolvePastShipPin(ctx, input, plan.onBuilding));
    }
    case 'attach':
    case 'orders':
      return pastShipPinHint(ctx, plan);
  }
}

function pastShipPinHint(ctx: HintContext, plan: PastShipPinPlan): PlanHint | null {
  if (plan.kind === 'orders') return ordersHint(ctx, plan);
  const { vehicle, settlers } = plan.attach;
  if (vehicleFull(ctx, vehicle, settlers)) return refusal('noRoom');
  const refused = settlers.every((settler) => ctx.answers.vehicleAttach(settler, vehicle) === false);
  return refused ? refusal('cannotBoard') : action('board');
}

/** A vehicle with every seat taken refuses each settler not already riding it; a pinned ship's commander
 *  slot, its trader's, offers no seat. */
function vehicleFull(ctx: HintContext, vehicle: number, settlers: readonly number[]): boolean {
  const e = entityById(ctx.snapshot, vehicle);
  const state = e?.components.Vehicle as { passengers?: unknown; hauler?: unknown } | undefined;
  const slots = state?.passengers;
  if (e === undefined || !Array.isArray(slots)) return false;
  const seated = vehicleSeatsOf(slots);
  const pinned = isShip(ctx.content, e) && num(state?.hauler) !== undefined;
  const open = pinned ? slots.slice(0, -1) : slots;
  if (vehicleSeatsOf(open).length < open.length) return false;
  return settlers.every((settler) => !seated.some((seat) => seat.entity === settler));
}

function ordersHint(ctx: HintContext, plan: RightClickOrders): PlanHint | null {
  if (plan.settlers.kind === 'select') return null;
  const parts: Part[] = [];
  if (plan.settlers.kind === 'orderLimit') parts.push({ count: 1, hint: refusal('tooManyUnits') });
  if (plan.settlers.kind === 'orders')
    for (const group of plan.settlers.groups) parts.push(...settlerParts(ctx, group));
  parts.push(...riderParts(ctx, plan.riders));
  if (vehiclesDrive(ctx, plan.riders)) parts.push(...vehicleParts(ctx, plan.vehicles));
  return mainOf(parts);
}

/** A trade toggle of the selected carts' riders takes the click from the carts, which drive only once
 *  nobody was detached and the sim refused every rider asked. */
function vehiclesDrive(ctx: HintContext, riders: RiderPlan): boolean {
  if (riders.kind !== 'tradeHouse') return true;
  return (
    riders.detach.length === 0 &&
    riders.ask.every((trader) => ctx.answers.tradeHouseAttach(trader, riders.house) === false)
  );
}

/** The largest order that goes ahead; with none going ahead, the largest refusal. */
function mainOf(parts: readonly Part[]): PlanHint | null {
  let best: Part | null = null;
  for (const part of parts) {
    const better =
      best === null ||
      (part.hint.tone === 'action' && best.hint.tone === 'refusal') ||
      (part.hint.tone === best.hint.tone && part.count > best.count);
    if (better) best = part;
  }
  return best?.hint ?? null;
}

function settlerParts(ctx: HintContext, group: SettlerGroup): Part[] {
  const count = group.units.length;
  const { intent } = group;
  switch (intent.kind) {
    case 'claimAnimal':
      return [{ count, hint: action('claim', { kind: 'creature', ref: intent.animal }) }];
    case 'attack':
      return [{ count, hint: action('attack') }];
    case 'hunt':
      return [{ count, hint: action('hunt', { kind: 'creature', ref: intent.prey }) }];
    case 'openChest':
      return [{ count, hint: action('openChest', { kind: 'chest', ref: intent.chest }) }];
    case 'eat':
      return [{ count, hint: action('eat', { kind: 'pile', ref: intent.pile }) }];
    case 'equip':
      return [{ count, hint: action('putOn', { kind: 'pile', ref: intent.pile }) }];
    case 'gather':
      return [{ count, hint: action('gather') }];
    case 'tradeHouse':
      return [{ count, hint: tradeHouseHint(ctx, intent.house, intent.detach, intent.ask) }];
    case 'walk':
      return [{ count, hint: action('walk') }];
    case 'school':
    case 'building':
    case 'queueAtBuilding':
    case 'site':
      return buildingParts(ctx, intent, count);
  }
}

/** A route toggle refused for every trader asked takes the house only off the others' routes, or is
 *  refused when nobody had it. */
function tradeHouseHint(
  ctx: HintContext,
  house: number,
  detach: readonly number[],
  ask: readonly number[],
): PlanHint {
  const refused = ask.every((trader) => ctx.answers.tradeHouseAttach(trader, house) === false);
  if (detach.length > 0 && (refused || detach.length > ask.length)) return action('removeFromRoute');
  return refused ? refusal('cannotAddToRoute') : action('addToRoute');
}

function riderParts(ctx: HintContext, plan: RiderPlan): Part[] {
  switch (plan.kind) {
    case 'none':
      return [];
    case 'orderLimit':
      return [{ count: 1, hint: refusal('tooManyUnits') }];
    case 'tradeHouse':
      return [
        {
          count: plan.detach.length + plan.ask.length,
          hint: tradeHouseHint(ctx, plan.house, plan.detach, plan.ask),
        },
      ];
  }
}

function vehicleParts(ctx: HintContext, plan: VehiclePlan): Part[] {
  switch (plan.kind) {
    case 'none':
      return [];
    case 'orderLimit':
      return [{ count: 1, hint: refusal('tooManyUnits') }];
    case 'orders':
      return plan.groups.map((group) => ({ count: group.vehicles.length, hint: vehicleHint(ctx, group) }));
  }
}

function vehicleHint(ctx: HintContext, { vehicles, intent }: VehicleGroup): PlanHint {
  const ships = vehicles.filter((id) => {
    const self = entityById(ctx.snapshot, id);
    return self !== undefined && isShip(ctx.content, self);
  });
  const moors = (tile: Tile, lands: boolean): PlanHint =>
    ctx.answers.docks(ships, tile) ? action(lands ? 'moorAndLand' : 'moor') : action('sail');
  switch (intent.kind) {
    case 'strike':
      return action('attack');
    case 'loadInto':
      return action('loadAboard');
    case 'drive':
      return ships.length === 0 ? action('drive') : moors(intent.tile, intent.lands);
    case 'driveFormation':
      return action(ships.length === vehicles.length ? 'sail' : 'drive');
    case 'dock':
      return moors(intent.tile, intent.lands);
  }
}

/** A building rung splits into the orders its builders, recruits, households and workers take. */
function buildingParts(ctx: HintContext, intent: BuildingIntent, count: number): Part[] {
  const crewVerb = (building: number): HintAction =>
    entityById(ctx.snapshot, building)?.components.UnderConstruction !== undefined ? 'build' : 'repair';
  const parts: Part[] = [];
  const add = (units: number, hint: PlanHint): void => {
    if (units > 0) parts.push({ count: units, hint });
  };
  switch (intent.kind) {
    case 'school': {
      add(intent.crew.length, action(crewVerb(intent.building)));
      const learners = intent.learners.map((unit) => unit.ref);
      add(schoolStudents(ctx.content, ctx.snapshot, learners).length, action('learn'));
      break;
    }
    case 'building':
      add(intent.crew.length, action(crewVerb(intent.building)));
      add(intent.trainees.length, action('train'));
      add(intent.household.length, householdHint(ctx, intent.building, intent.household));
      add(intent.workers.length, workersHint(ctx, intent.building, intent.workers));
      break;
    case 'queueAtBuilding':
      add(intent.crew.length, action(crewVerb(intent.building)));
      add(intent.recruits.length, action('train'));
      add(intent.walkers.length, action('walk'));
      break;
    case 'site':
      add(intent.builders.length, action('build'));
      add(intent.walkers.length, action('walk'));
      break;
  }
  // A building none of the selection takes gets no order at all.
  return parts.length > 0 ? parts : [{ count, hint: refusal('cannotWorkHere') }];
}

/** A home with no family slot free refuses every family not already living there. */
function householdHint(
  ctx: HintContext,
  house: number,
  household: readonly { readonly ref: number }[],
): PlanHint {
  const def = buildingDefOf(ctx, house);
  const moving = household.filter((unit) => {
    const self = entityById(ctx.snapshot, unit.ref);
    return self === undefined || residenceHomeOf(self) !== house;
  });
  const full = def !== undefined && moving.length > 0 && !homeHasFamilyRoom(ctx.snapshot, house, def);
  return full ? refusal('noFreePlaces') : action('live');
}

function buildingDefOf(ctx: HintContext, building: number) {
  const entity = entityById(ctx.snapshot, building);
  const type = entity === undefined ? undefined : buildingTypeOf(entity);
  return type === undefined ? undefined : contentLookups(ctx.content).buildings.get(type);
}

/**
 * The workers the sim tries at a workplace, as its group placement picks them: the unemployed while
 * any is, otherwise everyone not already working there. Each takes the first trade of its list with a
 * free slot, as far as the job-choice answers confirm it may take that trade; a worker it cannot
 * confirm leaves the new trade unnamed. Every tried worker whose trades are all full is refused, and
 * so is a group of whom the sim takes nobody: women and children take no post.
 */
function workersHint(ctx: HintContext, building: number, workers: readonly BuildingWorker[]): PlanHint {
  const def = buildingDefOf(ctx, building);
  const slots = def?.workers ?? [];
  const placed = (worker: BuildingWorker): number | undefined => {
    const self = entityById(ctx.snapshot, worker.unit.ref);
    return self === undefined ? undefined : workplaceOf(self);
  };
  const candidates = workers.filter((worker) => placed(worker) !== building);
  const unplaced = candidates.filter((worker) => placed(worker) === undefined);
  const tried = (unplaced.length > 0 ? unplaced : candidates).filter((worker) => {
    const self = entityById(ctx.snapshot, worker.unit.ref);
    return self !== undefined && isAdult(self) && !isFemale(self);
  });
  if (candidates.length === 0) return action('work');
  if (tried.length === 0) return refusal('cannotWorkHere');
  const staffed = staffingOf(ctx.snapshot, building);
  const room = (jobType: number): number => {
    const slot = slots.find((s) => s.jobType === jobType);
    return slot === undefined ? 0 : slot.count - (staffed.get(jobType) ?? 0);
  };
  if (tried.every((worker) => worker.jobPriority.every((jobType) => room(jobType) <= 0)))
    return refusal('noFreePlaces');
  return action('work', null, newTradeOf(ctx, tried, staffed, room));
}

/** The one trade every seated worker ends up in, when it changes someone's and every pick is known. */
function newTradeOf(
  ctx: HintContext,
  tried: readonly BuildingWorker[],
  staffed: Map<number, number>,
  room: (jobType: number) => number,
): number | null {
  let trade: number | null = null;
  let changes = false;
  for (const worker of tried) {
    const self = entityById(ctx.snapshot, worker.unit.ref);
    const current = self === undefined ? undefined : settlerJobType(self);
    const jobType = worker.jobPriority.find((job) => room(job) > 0);
    if (jobType === undefined) continue;
    if (systems.isFighterJob(ctx.content, jobType) && current !== jobType) return null;
    if (jobType !== current) {
      if (ctx.answers.jobChoice(worker.unit.ref, jobType) !== true) return null;
      changes = true;
    }
    if (trade !== null && trade !== jobType) return null;
    trade = jobType;
    staffed.set(jobType, (staffed.get(jobType) ?? 0) + 1);
  }
  return changes ? trade : null;
}
