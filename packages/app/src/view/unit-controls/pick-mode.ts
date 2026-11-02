import type { UiCue } from '@open-northland/audio';
import { type BuildingType, type ContentSet, lastByTypeId } from '@open-northland/data';
import type { TargetFlashTone, TargetMark } from '@open-northland/render';
import {
  type Entity,
  entitiesWith,
  entityById,
  MAX_UNIT_ORDER_MEMBERS,
  type PlayerCommand,
  type UnitSelectionCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import { diag } from '../../diag/index.js';
import { ownerPlayerOf } from '../../game/snapshot/index.js';
import { clampTile, nodeBounds, pickTopAt, type Tile } from '../picking.js';
import { memoBySnapshot } from '../projections/index.js';
import {
  computeAssignHighlight,
  computeHouseHighlight,
  drillPick,
  houseAssignableAt,
  markOf,
  schoolPick,
  sitePick,
  type TradeHouseRule,
  type TradeShipRule,
  tradeHousePick,
  tradeShipPick,
  workerGroupAt,
} from './highlights/index.js';
import type { AnsweredOrders } from './orders/answered.js';
import { DOCK_PICK_SNAP_NODES } from './orders/berths.js';
import type { UnitOrderController } from './orders/controller.js';
import { enqueueUnitSelection } from './orders/group.js';
import type { VehicleOrderController } from './orders/vehicle.js';
import { enemyAt, ownSettlerAt, ownVehicleAt, preyAt } from './pick-targets.js';
import { isShip } from './right-click/vehicles.js';
import type { UnitTargetKind, UnitTargets } from './unit-targets.js';

const MIDDLE_BUTTON = 1;

/**
 * Arming one mode replaces whatever was armed; a left or right click, Esc, or a selection change
 * resolves or cancels it, while a middle-button drag scroll leaves it armed. A signpost click waits for
 * a fresh placement verdict and stays armed when refused. The map overview also leaves picked-target
 * modes armed: it cannot name the unit or building they want. Every mode carries the settlers it orders, the ones that
 * allowed the order when it was armed, so a mixed selection's order skips the rest.
 */
export type PickMode =
  | { readonly kind: BuildingPickKind; readonly units: readonly number[] }
  /** A flag trade's workplace pick: a lit building employs, any other spot plants the work flag there
   *  (a posted gatherer leaves its post for it). */
  | { readonly kind: 'workplace-or-flag'; readonly units: readonly number[] }
  | { readonly kind: ScoutPickKind; readonly scout: number }
  | { readonly kind: SpotPickKind; readonly units: readonly number[] }
  | { readonly kind: 'attack-move'; readonly units: readonly number[]; readonly vehicles: readonly number[] }
  | { readonly kind: StrikePickKind; readonly units: readonly number[] }
  | { readonly kind: 'vehicle'; readonly settler: number }
  /** The ship pinned to one trader's route. */
  | { readonly kind: 'trade-ship'; readonly trader: number }
  | { readonly kind: VehicleSpotPickKind; readonly vehicle: number }
  /** The dock order for one ship or a fleet: each moors at its own berth along the shore picked. */
  | { readonly kind: 'vehicle-dock'; readonly vehicles: readonly number[] }
  | { readonly kind: VehicleTargetPickKind; readonly vehicle: number };

/** The orders one scout resolves by clicking a spot on the map. */
type ScoutPickKind = 'signpost';

/** The orders that resolve by clicking one of the player's own buildings. */
export type BuildingPickKind = 'workplace' | 'home' | 'building-site' | 'learning-place' | 'trade-house';

/** The selection-wide orders that resolve against a spot on the ground; the attack-move also marches the
 *  selected siege vehicles there. */
type SpotPickKind = 'destination' | 'work-area';

/** The selection-wide orders that resolve against the unit or building drawn under the cursor. */
type StrikePickKind = 'attack-settler' | 'attack-building' | 'attack-animal' | 'attack-vehicle';

/** The vehicle window's orders that resolve against a spot: a drive or a bombardment. */
type VehicleSpotPickKind = 'vehicle-destination' | 'vehicle-attack-position';

/** The vehicle panel's orders that resolve against what is drawn under the cursor: an enemy of one
 *  kind, one of the player's own ships to ride in, an own settler to seat, or an own land vehicle to
 *  drive onto the ship's deck. */
export type VehicleTargetPickKind =
  | 'vehicle-attack-settler'
  | 'vehicle-attack-building'
  | 'vehicle-attack-vehicle'
  | 'vehicle-carrier'
  | 'vehicle-rider'
  | 'vehicle-deck';

/** A mode whose target is a spot, so any surface that names one - the world view or the map overview -
 *  can resolve it. */
type SpotMode = Extract<
  PickMode,
  { readonly kind: SpotPickKind | 'attack-move' | ScoutPickKind | VehicleSpotPickKind | 'vehicle-dock' }
>;

interface BuildingPick {
  readonly highlight: (
    snapshot: WorldSnapshot,
    settlers: readonly number[],
    byType: ReadonlyMap<number, BuildingType>,
    canTrade: TradeHouseRule,
  ) => TargetMark[];
  /** The orders a click on `building` issues, empty when it orders nothing; null for
   *  the trade-house pick, whose click asks the sim first. */
  readonly orders:
    | ((
        snapshot: WorldSnapshot,
        settlers: readonly number[],
        building: number,
        byType: ReadonlyMap<number, BuildingType>,
      ) => PlayerCommand[])
    | null;
}

/**
 * The capacity-bound placements go out as one group order, so the sim seats unplaced members first at
 * the tick it applies them: a quick second click then places the rest, even before the snapshot shows
 * the first click's result. Other placements share one bounded selection envelope.
 */
const BUILDING_PICKS: Readonly<Record<BuildingPickKind, BuildingPick>> = {
  workplace: {
    highlight: computeAssignHighlight,
    // This mode places each settler's current trade only; it never re-trades.
    orders: (snapshot, settlers, building, byType) => {
      const workers = workerGroupAt(snapshot, building, settlers, byType);
      return workers === null || workers.length === 0
        ? []
        : [{ kind: 'assignWorkerGroup', building: building as Entity, members: workers }];
    },
  },
  home: {
    highlight: computeHouseHighlight,
    orders: (snapshot, settlers, building, byType) =>
      houseAssignableAt(snapshot, building, settlers, byType)
        ? [
            {
              kind: 'assignHouseGroup',
              members: settlers.map((e) => ({ entity: e as Entity })),
              house: building as Entity,
            },
          ]
        : [],
  },
  'building-site': {
    highlight: sitePick.highlight,
    orders: (snapshot, settlers, building, byType) =>
      settlers
        .filter((settler) => sitePick.assignableAt(snapshot, building, settler, byType))
        .map((settler) => ({ kind: 'assignBuilder', entity: settler as Entity, site: building as Entity })),
  },
  // The one building pick that reaches beyond the player's own houses: a trader's exchange happens at
  // another tribe's house that offers an agreement.
  'trade-house': {
    highlight: (snapshot, settlers, _byType, canTrade) =>
      tradeHousePick.highlight(snapshot, settlers, canTrade),
    orders: null,
  },
  // A school is resolved before these orders: its pick opens the course dialog instead.
  'learning-place': {
    highlight: (snapshot, settlers, byType) => [
      ...drillPick.highlight(snapshot, settlers, byType),
      ...schoolPick.highlight(snapshot, settlers, byType),
    ],
    orders: (snapshot, settlers, building, byType) =>
      settlers
        .filter((settler) => drillPick.assignableAt(snapshot, building, settler, byType))
        .map((settler) => ({ kind: 'trainSoldier', entity: settler as Entity, house: building as Entity })),
  },
};

/** The building pick a mode lights up and resolves against, null for a mode that names no building. */
const buildingPickOf = (mode: PickMode): BuildingPickKind | null => {
  if (mode.kind === 'workplace-or-flag') return 'workplace';
  return Object.hasOwn(BUILDING_PICKS, mode.kind) ? (mode.kind as BuildingPickKind) : null;
};

const SPOT_MODES: ReadonlySet<PickMode['kind']> = new Set<
  SpotPickKind | 'attack-move' | ScoutPickKind | VehicleSpotPickKind | 'vehicle-dock'
>([
  'destination',
  'work-area',
  'attack-move',
  'signpost',
  'vehicle-destination',
  'vehicle-dock',
  'vehicle-attack-position',
]);

const isSpotMode = (mode: PickMode): mode is SpotMode => SPOT_MODES.has(mode.kind);

/** The enemies each strike pick takes; an army's strike also takes the unowned walls. */
const STRIKE_KINDS: Readonly<Record<Exclude<StrikePickKind, 'attack-animal'>, readonly UnitTargetKind[]>> = {
  'attack-settler': ['settler'],
  'attack-building': ['building', 'palisade'],
  'attack-vehicle': ['vehicle'],
};

/** The enemy each vehicle strike pick takes. */
const VEHICLE_STRIKE_KIND: Readonly<
  Record<Extract<VehicleTargetPickKind, `vehicle-attack-${string}`>, UnitTargetKind>
> = {
  'vehicle-attack-settler': 'settler',
  'vehicle-attack-building': 'building',
  'vehicle-attack-vehicle': 'vehicle',
};

/**
 * What a left press at a point would do in the armed mode, read off the same lookups and verdicts the
 * press resolves by; `fits` false where the press would refuse. Null where the press names no target.
 */
export type PickAim =
  | { readonly kind: 'strike'; readonly target: number; readonly creature: boolean }
  | { readonly kind: 'attackMove' }
  | { readonly kind: 'walk' }
  | { readonly kind: 'workArea' }
  | { readonly kind: 'signpost'; readonly fits: boolean }
  | { readonly kind: 'drive'; readonly ship: boolean }
  | { readonly kind: 'dock'; readonly fits: boolean; readonly lands: boolean }
  | { readonly kind: 'bombard' }
  | {
      readonly kind: 'building';
      readonly pick: BuildingPickKind;
      readonly building: number;
      readonly fits: boolean;
      /** A school offers its courses to the settlers that may learn there. */
      readonly school: boolean;
    }
  | { readonly kind: 'board'; readonly fits: boolean }
  | { readonly kind: 'loadAboard'; readonly fits: boolean }
  | { readonly kind: 'pinShip'; readonly fits: boolean };

/** The orders a Shift press queues behind each settler's or vehicle's current order (the sim's
 *  `QUEUEABLE_ORDER_KINDS` and `QUEUEABLE_VEHICLE_ORDER_KINDS`), keeping the mode armed while Shift is
 *  held. A post, a home, a trade stop and a work flag are standing settings, which apply at once. */
type QueueableKind = Exclude<
  PickMode['kind'],
  'workplace' | 'workplace-or-flag' | 'home' | 'trade-house' | 'trade-ship' | 'work-area'
>;

const QUEUEABLE_MODES: ReadonlySet<PickMode['kind']> = new Set<QueueableKind>([
  'destination',
  'attack-move',
  'signpost',
  'building-site',
  'learning-place',
  'attack-settler',
  'attack-building',
  'attack-animal',
  'attack-vehicle',
  'vehicle',
  'vehicle-destination',
  'vehicle-dock',
  'vehicle-attack-position',
  'vehicle-attack-settler',
  'vehicle-attack-building',
  'vehicle-attack-vehicle',
  'vehicle-carrier',
  'vehicle-rider',
  'vehicle-deck',
]);

export interface PickModeDeps {
  readonly onOrderLimit?: (() => void) | undefined;
  readonly snapshot: () => WorldSnapshot;
  /** Bumped when an attach rule's answer lands anew, which re-lights the picks under one snapshot. */
  readonly answersVersion?: () => number;
  readonly targets: UnitTargets;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  /** The half-cell node a click on the world view names. */
  readonly nodeAt: (clientX: number, clientY: number) => Tile;
  readonly enqueue: (command: PlayerCommand) => void;
  /** The order controller owns every selection-wide order, so a walk fans a group out through the same
   *  formation spread whether it was armed here or right-clicked. Read at click time: it is built after
   *  this controller. */
  readonly orders: () => UnitOrderController;
  /** The vehicle orders, read at click time like {@link orders}. */
  readonly vehicleOrders: () => VehicleOrderController;
  /** Named addition: the original signals an armed mode with prompt text, not a cursor. */
  readonly setArmedCursor: (mode: PickMode | null) => void;
  /** The sim's attach rule as its last answer, which the "Assign Vehicle" pick lights the settler's own
   *  vehicles by; absent, the pick lights nothing. */
  readonly canAttachToVehicle?: ((settler: number, vehicle: number) => boolean) | undefined;
  /** The sim's trade-stop rule as its last answer, which the trade-house pick lights by; absent, the
   *  pick lights nothing. */
  readonly canAttachTradeHouse?: TradeHouseRule | undefined;
  /** Says why the sim kept a house off a route; absent, the refusal is silent. */
  readonly onTradeRefused?: ((house: number) => void) | undefined;
  /** The same rule asked as the pick's click lands, which it orders by; absent, it orders nothing. */
  readonly askAttachTradeHouse?: ((trader: number, house: number) => Promise<boolean>) | undefined;
  /** The sim's ship pin rule as its last answer, which the trade-ship pick lights by; absent, the pick
   *  lights nothing. */
  readonly canPinTradeShip?: TradeShipRule | undefined;
  /** The same rule asked as the pick's click lands, which it pins by; absent, it pins nothing. */
  readonly askPinTradeShip?: ((trader: number, ship: number) => Promise<boolean>) | undefined;
  readonly askPlaceSignpostAt?: ((col: number, row: number) => Promise<boolean>) | undefined;
  /** The signpost, trade-stop and vehicle attach rules' last answers, undefined while unanswered, which
   *  the label beside the cursor reads; it names the press optimistically without one. */
  readonly signpostAnswerAt?: ((col: number, row: number) => boolean | undefined) | undefined;
  readonly tradeHouseAttachAnswer?: ((trader: number, house: number) => boolean | undefined) | undefined;
  readonly vehicleAttachAnswer?: ((settler: number, vehicle: number) => boolean | undefined) | undefined;
  readonly tradeShipPinAnswer?: ((trader: number, ship: number) => boolean | undefined) | undefined;
  /** Feedback for a signpost click whose verdict arrives after the synchronous pointer handler. */
  readonly cue?: ((cue: UiCue) => void) | undefined;
  /** Where the orders a host answer decides wait for it. */
  readonly answered: AnsweredOrders;
  /** Flashes an order's target once; absent, nothing is drawn. */
  readonly flashTarget?: ((entity: number, tone: TargetFlashTone) => void) | undefined;
}

/**
 * What a press did to an armed mode, for the caller's click feedback: `ordered` placed the order,
 * `missed` found no target under the press (approximation: the original keeps its tool armed after a
 * miss, this drops it), `pending` awaits a fresh signpost verdict, and `calledOff` was any other button.
 * An invalid signpost remains armed. Null when no mode was armed.
 */
export type PickPress = 'ordered' | 'missed' | 'calledOff' | 'pending';

/** The GUI click a pick press answers with: an order confirms, a call-off fails, a miss is silent. */
export function pickPressCue(press: PickPress): UiCue | null {
  switch (press) {
    case 'ordered':
      return 'confirm';
    case 'calledOff':
      return 'fail';
    case 'missed':
    case 'pending':
      return null;
    default: {
      const unreachable: never = press;
      return unreachable;
    }
  }
}

export interface PickModeController {
  arm(mode: PickMode): void;
  cancel(): void;
  isArmed(): boolean;
  /** The armed mode, for a control that lights while its pick waits; null when none is. */
  armed(): PickMode | null;
  signpostActive(): boolean;
  /** The first ship of the armed dock pick, or null: the frame loop washes the map with its mooring
   *  spots. */
  dockVehicle(): number | null;
  /** The ships of the armed dock pick, empty while none is armed: the cursor previews their berths. */
  dockShips(): readonly number[];
  /** A pick that plants a work flag is armed (a flag trade's workplace pick or the work-area pick), so
   *  the flag ghost follows the cursor. */
  flagActive(): boolean;
  /** Non-null when a mode was armed: the press resolved or cancelled it, so the caller must not fall
   *  through to selection or an order. */
  handleMouseDown(event: MouseEvent): PickPress | null;
  /** A press on the map overview, which names the node `target` and nothing drawn there. A spot-target
   *  mode resolves; one that needs a picked unit or building stays armed, so scrolling the overview to
   *  find that target does not call it off. `shift` is a Shift press. Non-null when the armed mode took
   *  the press. */
  handleOverviewPress(button: number, target: Tile, shift?: boolean, primary?: boolean): PickPress | null;
  /** Shift was let go (or the window lost focus): a mode a Shift press kept armed ends with it. */
  endShiftChain(): void;
  /** The armed mode's verdicts on its targets: a building pick's candidate buildings, the "Assign
   *  Vehicle" pick's own vehicles. Null when the armed mode judges no targets. */
  highlight(): readonly TargetMark[] | null;
  /** The judged target a press at the client point would name, with its verdict; null off every one. */
  aimedAt(clientX: number, clientY: number): TargetMark | null;
  /** What a left press at the client point would do; `primary` is a held Ctrl (Cmd on a Mac). Null
   *  while nothing is armed or where the press names no target. */
  aimAt(clientX: number, clientY: number, primary: boolean): PickAim | null;
  /** Bumped by every arm and cancel. */
  version(): number;
}

/** The settler's owner's vehicles, lit where the sim's attach rule takes the settler, refused otherwise. */
function computeVehicleHighlight(
  snapshot: WorldSnapshot,
  settler: number,
  canAttach: (settler: number, vehicle: number) => boolean,
): TargetMark[] {
  const self = entityById(snapshot, settler);
  const owner = self === undefined ? undefined : ownerPlayerOf(self);
  if (owner === undefined) return [];
  const items: TargetMark[] = [];
  for (const e of entitiesWith(snapshot, 'Vehicle')) {
    if (ownerPlayerOf(e) !== owner) continue;
    items.push(markOf(e.id, canAttach(settler, e.id)));
  }
  return items;
}

export function createPickModeController(deps: PickModeDeps): PickModeController {
  const buildingsByType = lastByTypeId(deps.content.buildings);
  const canTrade: TradeHouseRule = deps.canAttachTradeHouse ?? (() => false);
  let pickMode: PickMode | null = null;
  let pickVersion = 0;
  /** The armed mode was kept armed by a queued Shift press rather than armed by the player. */
  let shiftChain = false;
  type SignpostPress = { readonly target: Tile; readonly queued: boolean; verdict: boolean | null };
  let pendingSignposts: SignpostPress[] = [];
  let endSignpostChain = false;
  const setMode = (next: PickMode | null): void => {
    pickMode = next;
    pickVersion++;
    shiftChain = false;
    pendingSignposts = [];
    endSignpostChain = false;
    deps.setArmedCursor(next);
  };
  const cancel = (): void => setMode(null);

  const buildingAt = (clientX: number, clientY: number, kind: BuildingPickKind): number | null => {
    const w = deps.toWorld(clientX, clientY);
    const candidates =
      kind === 'trade-house'
        ? deps.targets.buildings()
        : kind === 'building-site'
          ? [
              ...deps.targets.owned('building'),
              ...deps.targets.owned('palisade'),
              ...deps.targets.owned('roadsite'),
            ]
          : deps.targets.owned('building');
    return pickTopAt(candidates, w.x, w.y);
  };
  const buildingUnder = (event: MouseEvent, kind: BuildingPickKind): number | null =>
    buildingAt(event.clientX, event.clientY, kind);

  /** The settlers among `settlers` that may take a course at the school `building`. */
  const learnersAt = (building: number, settlers: readonly number[]): readonly number[] =>
    settlers.filter((settler) =>
      schoolPick.assignableAt(deps.snapshot(), building, settler, buildingsByType),
    );

  /** A `queued` press lines a site or a drill up behind each settler's current order. */
  const orderAtBuilding = (
    building: number,
    kind: BuildingPickKind,
    settlers: readonly number[],
    queued = false,
  ): boolean => {
    if (settlers.length > MAX_UNIT_ORDER_MEMBERS) {
      deps.onOrderLimit?.();
      return false;
    }
    const snapshot = deps.snapshot();
    if (kind === 'learning-place') {
      const learners = learnersAt(building, settlers);
      if (learners.length > 0) return deps.orders().openSchool(building, learners);
    }
    const pick = BUILDING_PICKS[kind].orders;
    if (pick === null) return attachTradeHouse(settlers, building);
    const orders = pick(snapshot, settlers, building, buildingsByType);
    const selectedOrders = orders
      .filter(
        (order): order is Extract<UnitSelectionCommand, { kind: 'assignBuilder' | 'trainSoldier' }> =>
          order.kind === 'assignBuilder' || order.kind === 'trainSoldier',
      )
      .map((order) => (queued ? { ...order, queued } : order));
    let ordered: boolean;
    if (selectedOrders.length > 0) {
      ordered = enqueueUnitSelection(selectedOrders, deps.enqueue, deps.onOrderLimit);
    } else {
      for (const order of orders) deps.enqueue(order);
      ordered = orders.length > 0;
    }
    if (ordered) deps.flashTarget?.(building, 'assign');
    return ordered;
  };

  const resolveBuilding = (
    event: MouseEvent,
    kind: BuildingPickKind,
    settlers: readonly number[],
    queued: boolean,
  ): boolean => {
    const building = buildingUnder(event, kind);
    return building !== null && orderAtBuilding(building, kind, settlers, queued);
  };

  /** Put `house` on the route of each trader the sim admits, once it answered. */
  const attachTradeHouse = (traders: readonly number[], house: number): boolean => {
    const ask = deps.askAttachTradeHouse;
    if (ask === undefined || traders.length === 0) return false;
    deps.answered.after(Promise.all(traders.map((trader) => ask(trader, house))), (verdicts) => {
      const commands: UnitSelectionCommand[] = traders.flatMap((trader, index) =>
        verdicts[index] === true
          ? [{ kind: 'attachTradeHouse', entity: trader as Entity, house: house as Entity }]
          : [],
      );
      enqueueUnitSelection(commands, deps.enqueue, deps.onOrderLimit);
      if (commands.length < traders.length) deps.onTradeRefused?.(house);
    });
    return true;
  };

  /** Pin the ship under the press to the trader, once the sim admitted it. */
  const pinTradeShip = (trader: number, ship: number | null): boolean => {
    const ask = deps.askPinTradeShip;
    if (ask === undefined || ship === null) return false;
    deps.answered.after(ask(trader, ship), (admitted) => {
      if (!admitted) {
        deps.cue?.('fail');
        return;
      }
      deps.enqueue({ kind: 'setTradeShip', entity: trader as Entity, ship: ship as Entity });
      deps.flashTarget?.(ship, 'assign');
    });
    return true;
  };

  /** `queued` applies to the {@link QUEUEABLE_MODES}; `lands` has a dock land the crew once moored. */
  const resolveSpot = (
    mode: Exclude<SpotMode, { readonly kind: 'signpost' }>,
    named: Tile,
    queued: boolean,
    lands = false,
  ): boolean => {
    const { width, height } = nodeBounds(deps.mapSize);
    const target = clampTile(named, width, height);
    switch (mode.kind) {
      case 'destination':
        return deps.orders().issueMoveTo(target, mode.units, queued);
      case 'work-area':
        return deps.orders().issueSetWorkFlag(target, mode.units);
      case 'attack-move': {
        if (mode.units.length + mode.vehicles.length > MAX_UNIT_ORDER_MEMBERS) {
          deps.onOrderLimit?.();
          return false;
        }
        const marched =
          mode.units.length > 0 && deps.orders().issueAttackMove(target, mode.units, queued, mode.vehicles);
        const marchedVehicles =
          mode.vehicles.length > 0 && deps.vehicleOrders().issueAttackMove(mode.vehicles, target, queued);
        return marched || marchedVehicles;
      }
      case 'vehicle-destination':
        return deps.vehicleOrders().issueMoveTo(mode.vehicle, target, queued);
      case 'vehicle-dock':
        return deps.vehicleOrders().issueDock(mode.vehicles, target, queued, lands);
      case 'vehicle-attack-position':
        return deps.vehicleOrders().issueAttackPosition(mode.vehicle, target, queued);
      default: {
        const unreachable: never = mode;
        throw new Error(`unhandled spot pick mode: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  /** Fresh answers may land in any order; queued presses must still submit in click order. */
  const resolveSignpostPress = (
    mode: Extract<SpotMode, { readonly kind: 'signpost' }>,
    named: Tile,
    queued: boolean,
  ): PickPress => {
    if (!queued) {
      shiftChain = false;
      pickVersion++;
      pendingSignposts = [];
    }
    endSignpostChain = false;
    const version = pickVersion;
    const { width, height } = nodeBounds(deps.mapSize);
    const press: SignpostPress = { target: clampTile(named, width, height), queued, verdict: null };
    pendingSignposts.push(press);
    const answer = deps.askPlaceSignpostAt?.(press.target.col, press.target.row) ?? Promise.resolve(false);
    deps.answered.after(
      answer.catch((error: unknown) => {
        diag.warn('orders', 'a signpost click went unanswered by the host', { error: String(error) });
        return false;
      }),
      (verdict) => {
        if (version !== pickVersion || pickMode !== mode) return;
        press.verdict = verdict;
        while (pendingSignposts.length > 0 && pendingSignposts[0]?.verdict !== null) {
          const next = pendingSignposts.shift();
          if (next === undefined) break;
          if (!next.verdict) {
            deps.cue?.('fail');
            continue;
          }
          deps.enqueue({
            kind: 'placeSignpost',
            entity: mode.scout as Entity,
            x: next.target.col,
            y: next.target.row,
            ...(next.queued ? { queued: true } : {}),
          });
          deps.cue?.('confirm');
          if (!next.queued && pendingSignposts.length === 0) {
            cancel();
            return;
          }
          shiftChain = true;
        }
        if (pendingSignposts.length === 0 && endSignpostChain) {
          endSignpostChain = false;
          if (shiftChain) cancel();
        }
      },
    );
    return 'pending';
  };

  /** Plant the flag of every unit at `named`; one holding a post leaves it first, since the Workplace row's
   *  ground pick trades the post for the worker's own flag. */
  const resolveFlag = (units: readonly number[], named: Tile): boolean =>
    deps.orders().issueSetWorkFlag(named, units, true);

  /** `queued` applies to the {@link QUEUEABLE_MODES}. */
  const resolvePicked = (mode: Exclude<PickMode, SpotMode>, event: MouseEvent, queued: boolean): boolean => {
    switch (mode.kind) {
      case 'workplace':
      case 'home':
      case 'building-site':
      case 'learning-place':
      case 'trade-house':
        return resolveBuilding(event, mode.kind, mode.units, queued);
      case 'workplace-or-flag': {
        // A building under the click answers for the press: one that turns the settler down refuses it,
        // and the flag goes only where no own building stands.
        const building = buildingUnder(event, 'workplace');
        return building === null
          ? resolveFlag(mode.units, deps.nodeAt(event.clientX, event.clientY))
          : orderAtBuilding(building, 'workplace', mode.units);
      }
      case 'attack-settler':
      case 'attack-building':
      case 'attack-vehicle':
        return deps.orders().issueAttackTarget(event, STRIKE_KINDS[mode.kind], mode.units, queued);
      case 'attack-animal':
        return deps.orders().issueAttackAnimal(event, mode.units, queued);
      case 'vehicle':
        return deps.vehicleOrders().issueAttach(event, mode.settler, queued);
      case 'trade-ship':
        return pinTradeShip(
          mode.trader,
          ownVehicleAt(deps.targets, deps.toWorld(event.clientX, event.clientY)),
        );
      case 'vehicle-attack-settler':
      case 'vehicle-attack-building':
      case 'vehicle-attack-vehicle':
        return deps
          .vehicleOrders()
          .issueAttackTarget(event, mode.vehicle, VEHICLE_STRIKE_KIND[mode.kind], queued);
      case 'vehicle-carrier':
        return deps.vehicleOrders().issueLoadInto(event, mode.vehicle, queued);
      case 'vehicle-rider':
        return deps.vehicleOrders().issueSeatRider(event, mode.vehicle, queued);
      case 'vehicle-deck':
        return deps.vehicleOrders().issueDeckLoad(event, mode.vehicle, queued);
      default: {
        const unreachable: never = mode;
        throw new Error(`unhandled pick mode: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  const pressOutcome = (ordered: boolean): PickPress => (ordered ? 'ordered' : 'missed');

  const handleMouseDown = (event: MouseEvent): PickPress | null => {
    const mode = pickMode;
    if (mode === null || event.button === MIDDLE_BUTTON) return null;
    // A selection change cancels any armed mode, so the selection read at click time is still the one
    // this mode was armed for.
    if (mode.kind !== 'signpost' || event.button !== 0) cancel();
    if (event.button !== 0) return 'calledOff'; // any other button just calls the mode off
    // The march engages enemies only, never game, so an attack-move pressed on a wild animal strikes it;
    // the selected vehicles still march to the spot.
    const queued = queuedPress(mode, event);
    if (
      mode.kind === 'attack-move' &&
      mode.units.length > 0 &&
      deps.orders().issueAttackAnimal(event, mode.units, queued)
    ) {
      if (mode.vehicles.length > 0)
        resolveSpot({ ...mode, units: [] }, deps.nodeAt(event.clientX, event.clientY), queued);
      return chained(mode, true, queued);
    }
    if (isSpotMode(mode))
      return resolveSpotPress(
        mode,
        deps.nodeAt(event.clientX, event.clientY),
        event.shiftKey,
        event.ctrlKey || event.metaKey,
      );
    return chained(mode, resolvePicked(mode, event, queued), queued);
  };

  /** Whether a press queues its order: a Shift press in a queueable mode, except on a school, whose course
   *  is chosen in its dialog, so the press opens it as a plain press does. */
  const queuedPress = (mode: PickMode, event: MouseEvent): boolean => {
    if (!event.shiftKey || !QUEUEABLE_MODES.has(mode.kind)) return false;
    if (mode.kind !== 'learning-place') return true;
    const building = buildingUnder(event, mode.kind);
    return building === null || learnersAt(building, mode.units).length === 0;
  };

  /** A Shift press queues a queueable order for the units it names and keeps the mode armed while Shift
   *  is held, so a chain of presses lays a route, a signpost line or a run of targets. */
  const chained = (mode: PickMode, ordered: boolean, queued: boolean): PickPress => {
    if (ordered && queued) {
      setMode(mode);
      shiftChain = true;
    }
    return pressOutcome(ordered);
  };

  /** `primary` is a Ctrl (Cmd on a Mac) press, which has a dock land the crew once the ships moor. */
  const resolveSpotPress = (mode: SpotMode, target: Tile, shift: boolean, primary = false): PickPress => {
    const queued = shift && QUEUEABLE_MODES.has(mode.kind);
    if (mode.kind === 'signpost') return resolveSignpostPress(mode, target, queued);
    return chained(mode, resolveSpot(mode, target, queued, primary), queued);
  };

  const handleOverviewPress = (
    button: number,
    target: Tile,
    shift = false,
    primary = false,
  ): PickPress | null => {
    const mode = pickMode;
    if (mode === null || button === MIDDLE_BUTTON) return null;
    if (button !== 0) {
      cancel(); // any other button just calls the mode off
      return 'calledOff';
    }
    if (!isSpotMode(mode)) return null;
    if (mode.kind !== 'signpost') cancel();
    return resolveSpotPress(mode, target, shift, primary);
  };

  /** Read every frame, so the O(entities) pass is memoized on everything it reads: the snapshot instance
   *  plus `pickVersion`, which every arm and cancel bumps, and the attach rules' landed answers. */
  const highlightFor = memoBySnapshot(
    (snapshot: WorldSnapshot) => {
      const mode = pickMode;
      if (mode === null) return null;
      if (mode.kind === 'vehicle') {
        const canAttach = deps.canAttachToVehicle;
        return canAttach === undefined ? null : computeVehicleHighlight(snapshot, mode.settler, canAttach);
      }
      if (mode.kind === 'trade-ship') {
        const canPin = deps.canPinTradeShip;
        return canPin === undefined ? null : tradeShipPick.highlight(snapshot, mode.trader, canPin);
      }
      // Only the building picks light targets up; the rest show on the ground or the cursor.
      const kind = buildingPickOf(mode);
      if (kind === null || !('units' in mode)) return null;
      return BUILDING_PICKS[kind].highlight(snapshot, mode.units, buildingsByType, canTrade);
    },
    () => pickVersion + (deps.answersVersion?.() ?? 0),
  );

  /** The last aim, kept while the point, the snapshot and the verdicts hold still. */
  const aim: {
    marks: readonly TargetMark[] | null;
    byId: ReadonlyMap<number, TargetMark>;
    snapshot: WorldSnapshot | null;
    x: number;
    y: number;
    target: number | null;
    mark: TargetMark | null;
  } = {
    marks: null,
    byId: new Map(),
    snapshot: null,
    x: Number.NaN,
    y: Number.NaN,
    target: null,
    mark: null,
  };

  /** The judged mode's target under the client point and its mark; a target the highlight left unjudged
   *  has none. Null while the armed mode judges no targets. */
  const aimTarget = (
    clientX: number,
    clientY: number,
  ): { readonly target: number | null; readonly mark: TargetMark | null } | null => {
    const snapshot = deps.snapshot();
    const marks = highlightFor(snapshot);
    const mode = pickMode;
    if (marks === null || mode === null) return null;
    const kind = mode.kind === 'vehicle' || mode.kind === 'trade-ship' ? 'vehicle' : buildingPickOf(mode);
    if (kind === null) return null;
    const w = deps.toWorld(clientX, clientY);
    if (aim.marks === marks && aim.snapshot === snapshot && aim.x === w.x && aim.y === w.y) return aim;
    aim.target = kind === 'vehicle' ? ownVehicleAt(deps.targets, w) : buildingAt(clientX, clientY, kind);
    if (aim.marks !== marks) aim.byId = new Map(marks.map((mark) => [mark.id, mark]));
    aim.marks = marks;
    aim.snapshot = snapshot;
    aim.x = w.x;
    aim.y = w.y;
    aim.mark = aim.target === null ? null : (aim.byId.get(aim.target) ?? null);
    return aim;
  };

  /** A judged target takes the press where its mark is lit; an unjudged one orders nothing. */
  const judgedAim = (clientX: number, clientY: number): { target: number; fits: boolean } | null => {
    const judged = aimTarget(clientX, clientY);
    if (judged === null || judged.target === null) return null;
    return { target: judged.target, fits: judged.mark?.tone === 'candidate' };
  };

  const strikeAim = (target: number | null, creature = false): PickAim | null =>
    target === null ? null : { kind: 'strike', target, creature };

  const aimAt = (clientX: number, clientY: number, primary: boolean): PickAim | null => {
    const mode = pickMode;
    if (mode === null) return null;
    const world = deps.toWorld(clientX, clientY);
    switch (mode.kind) {
      case 'trade-house': {
        // The press asks every trader about any house, and takes it onto the route of each admitted.
        const building = buildingAt(clientX, clientY, 'trade-house');
        if (building === null) return null;
        const fits =
          deps.askAttachTradeHouse !== undefined &&
          mode.units.some((trader) => deps.tradeHouseAttachAnswer?.(trader, building) !== false);
        return { kind: 'building', pick: 'trade-house', building, fits, school: false };
      }
      case 'workplace':
      case 'home':
      case 'building-site':
      case 'learning-place':
      case 'workplace-or-flag': {
        const pick = buildingPickOf(mode) ?? 'workplace';
        const judged = judgedAim(clientX, clientY);
        if (judged === null) {
          const building = buildingAt(clientX, clientY, pick);
          if (building !== null) return { kind: 'building', pick, building, fits: false, school: false };
          return mode.kind === 'workplace-or-flag' ? { kind: 'workArea' } : null;
        }
        const school = pick === 'learning-place' && learnersAt(judged.target, mode.units).length > 0;
        return { kind: 'building', pick, building: judged.target, fits: judged.fits, school };
      }
      case 'destination':
        return { kind: 'walk' };
      case 'work-area':
        return { kind: 'workArea' };
      case 'attack-move': {
        const prey = mode.units.length > 0 ? strikeAim(preyAt(deps.targets, world), true) : null;
        return prey ?? { kind: 'attackMove' };
      }
      case 'signpost': {
        const node = clampedNode(clientX, clientY);
        return { kind: 'signpost', fits: deps.signpostAnswerAt?.(node.col, node.row) !== false };
      }
      case 'vehicle-destination': {
        const self = entityById(deps.snapshot(), mode.vehicle);
        return { kind: 'drive', ship: self !== undefined && isShip(deps.content, self) };
      }
      case 'vehicle-dock': {
        const berths = deps
          .vehicleOrders()
          .previewBerths(mode.vehicles, clampedNode(clientX, clientY), DOCK_PICK_SNAP_NODES);
        return { kind: 'dock', fits: berths.length > 0, lands: primary };
      }
      case 'vehicle-attack-position':
        return { kind: 'bombard' };
      case 'attack-settler':
      case 'attack-building':
      case 'attack-vehicle':
        return strikeAim(enemyAt(deps.targets, world, STRIKE_KINDS[mode.kind], true));
      case 'attack-animal':
        return strikeAim(preyAt(deps.targets, world), true);
      case 'vehicle-attack-settler':
      case 'vehicle-attack-building':
      case 'vehicle-attack-vehicle':
        return strikeAim(enemyAt(deps.targets, world, [VEHICLE_STRIKE_KIND[mode.kind]]));
      case 'vehicle': {
        const vehicle = ownVehicleAt(deps.targets, world);
        return vehicle === null
          ? null
          : { kind: 'board', fits: deps.vehicleAttachAnswer?.(mode.settler, vehicle) !== false };
      }
      case 'trade-ship': {
        const ship = ownVehicleAt(deps.targets, world);
        return ship === null
          ? null
          : { kind: 'pinShip', fits: deps.tradeShipPinAnswer?.(mode.trader, ship) !== false };
      }
      case 'vehicle-rider':
        // The attach rule is asked as the press lands, so the seat is offered until it answers.
        return ownSettlerAt(deps.targets, world) === null ? null : { kind: 'board', fits: true };
      case 'vehicle-carrier': {
        const carrier = ownVehicleAt(deps.targets, world);
        return carrier === null
          ? null
          : { kind: 'loadAboard', fits: deps.vehicleOrders().loadsInto(mode.vehicle, carrier) };
      }
      case 'vehicle-deck': {
        const vehicle = ownVehicleAt(deps.targets, world, mode.vehicle);
        return vehicle === null
          ? null
          : { kind: 'loadAboard', fits: deps.vehicleOrders().loadsInto(vehicle, mode.vehicle) };
      }
      default: {
        const unreachable: never = mode;
        throw new Error(`unhandled pick mode: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  /** The node a press at the client point names, clamped into the map as the spot presses clamp it. */
  const clampedNode = (clientX: number, clientY: number): Tile => {
    const { width, height } = nodeBounds(deps.mapSize);
    return clampTile(deps.nodeAt(clientX, clientY), width, height);
  };

  return {
    arm: setMode,
    cancel,
    isArmed: () => pickMode !== null,
    armed: () => pickMode,
    signpostActive: () => pickMode?.kind === 'signpost',
    dockVehicle: () => (pickMode?.kind === 'vehicle-dock' ? (pickMode.vehicles[0] ?? null) : null),
    dockShips: () => (pickMode?.kind === 'vehicle-dock' ? pickMode.vehicles : []),
    flagActive: () => pickMode?.kind === 'workplace-or-flag' || pickMode?.kind === 'work-area',
    handleMouseDown,
    handleOverviewPress,
    endShiftChain: () => {
      if (pendingSignposts.length > 0) endSignpostChain = true;
      else if (shiftChain) cancel();
    },
    highlight: () => highlightFor(deps.snapshot()),
    aimedAt: (clientX, clientY) => aimTarget(clientX, clientY)?.mark ?? null,
    aimAt,
    version: () => pickVersion,
  };
}
