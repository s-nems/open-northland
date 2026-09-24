import type { UiCue } from '@open-northland/audio';
import { type BuildingType, type ContentSet, lastByTypeId } from '@open-northland/data';
import type { BuildingHighlightItem } from '@open-northland/render';
import { type Entity, entityById, type PlayerCommand, type WorldSnapshot } from '@open-northland/sim';
import { isVehicle, ownerPlayerOf } from '../../game/snapshot.js';
import { clampTile, nodeBounds, pickTopAt, type Tile } from '../picking.js';
import { memoBySnapshot } from '../projections/index.js';
import {
  computeAssignHighlight,
  computeHouseHighlight,
  drillPick,
  houseAssignableAt,
  schoolPick,
  sitePick,
  tradeHousePick,
  workerGroupAt,
} from './highlights/index.js';
import type { UnitOrderController } from './orders.js';
import type { UnitTargets } from './unit-targets.js';
import type { VehicleOrderController } from './vehicle-orders.js';

/**
 * Arming one mode replaces whatever was armed; a click of any kind, Esc, or a selection change resolves
 * or cancels it. The map overview is the one surface that can leave a mode armed: it cannot name the
 * unit or building a picked-target mode wants. Every mode carries the settlers it orders, the ones that
 * allowed the order when it was armed, so a mixed selection's order skips the rest.
 */
export type PickMode =
  | { readonly kind: BuildingPickKind; readonly units: readonly number[] }
  | { readonly kind: ScoutPickKind; readonly scout: number }
  | { readonly kind: SpotPickKind; readonly units: readonly number[] }
  | { readonly kind: 'attack-move'; readonly units: readonly number[]; readonly vehicles: readonly number[] }
  | { readonly kind: StrikePickKind; readonly units: readonly number[] }
  | { readonly kind: 'vehicle'; readonly settler: number }
  | { readonly kind: VehicleSpotPickKind; readonly vehicle: number }
  | { readonly kind: VehicleTargetPickKind; readonly vehicle: number };

/** The orders one scout resolves by clicking a spot on the map. */
type ScoutPickKind = 'signpost' | 'explore';

/** The orders that resolve by clicking one of the player's own buildings. */
export type BuildingPickKind = 'workplace' | 'home' | 'building-site' | 'learning-place' | 'trade-house';

/** The selection-wide orders that resolve against a spot on the ground; the attack-move also marches the
 *  selected siege vehicles there. */
type SpotPickKind = 'destination' | 'work-area';

/** The selection-wide orders that resolve against the unit or building drawn under the cursor. */
type StrikePickKind = 'attack-settler' | 'attack-building' | 'attack-animal' | 'attack-vehicle';

/** The vehicle window's orders that resolve against a spot: a drive, a mooring point, a bombardment. */
export type VehicleSpotPickKind = 'vehicle-destination' | 'vehicle-dock' | 'vehicle-attack-position';

/** The vehicle window's orders that resolve against what is drawn under the cursor: an enemy of one
 *  kind, or one of the player's own ships to ride in. */
export type VehicleTargetPickKind =
  | 'vehicle-attack-settler'
  | 'vehicle-attack-building'
  | 'vehicle-attack-vehicle'
  | 'vehicle-carrier';

/** A mode whose target is a spot, so any surface that names one - the world view or the map overview -
 *  can resolve it. */
type SpotMode = Extract<
  PickMode,
  { readonly kind: SpotPickKind | 'attack-move' | ScoutPickKind | VehicleSpotPickKind }
>;

interface BuildingPick {
  readonly highlight: (
    snapshot: WorldSnapshot,
    settlers: readonly number[],
    byType: ReadonlyMap<number, BuildingType>,
  ) => BuildingHighlightItem[];
  /** The orders a click on `building` issues, empty when that building refuses every settler. */
  readonly orders: (
    snapshot: WorldSnapshot,
    settlers: readonly number[],
    building: number,
    byType: ReadonlyMap<number, BuildingType>,
  ) => PlayerCommand[];
}

/**
 * The capacity-bound placements go out as one group order, so the sim seats unplaced members first at
 * the tick it applies them: a quick second click then places the rest, even before the snapshot shows
 * the first click's result. The unbounded ones issue one order per accepted settler.
 */
const BUILDING_PICKS: Readonly<Record<BuildingPickKind, BuildingPick>> = {
  workplace: {
    highlight: computeAssignHighlight,
    // This mode places each settler's current trade only; it never re-trades.
    orders: (snapshot, settlers, building, byType) => {
      const workers = workerGroupAt(snapshot, building, settlers, byType);
      return workers === null
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
  // another tribe's house, so every standing house lights up but the ones already on the route.
  'trade-house': {
    highlight: (snapshot, settlers) => tradeHousePick.highlight(snapshot, settlers),
    orders: (snapshot, settlers, building) =>
      settlers
        .filter((settler) => tradeHousePick.assignableAt(snapshot, building, settler))
        .map((settler) => ({
          kind: 'attachTradeHouse',
          entity: settler as Entity,
          house: building as Entity,
        })),
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

const isBuildingPick = (mode: PickMode): mode is Extract<PickMode, { readonly kind: BuildingPickKind }> =>
  Object.hasOwn(BUILDING_PICKS, mode.kind);

const SPOT_MODES: ReadonlySet<PickMode['kind']> = new Set<
  SpotPickKind | 'attack-move' | ScoutPickKind | VehicleSpotPickKind
>([
  'destination',
  'work-area',
  'attack-move',
  'signpost',
  'explore',
  'vehicle-destination',
  'vehicle-dock',
  'vehicle-attack-position',
]);

const isSpotMode = (mode: PickMode): mode is SpotMode => SPOT_MODES.has(mode.kind);

/** Modes whose target is a point or a unit rather than a lit building, so the cursor carries the prompt. */
const CROSSHAIR_MODES: ReadonlySet<PickMode['kind']> = new Set<
  Exclude<PickMode['kind'], BuildingPickKind | 'signpost'>
>([
  'destination',
  'work-area',
  'attack-move',
  'attack-settler',
  'attack-building',
  'attack-animal',
  'attack-vehicle',
  'explore',
  'vehicle',
  'vehicle-destination',
  'vehicle-dock',
  'vehicle-attack-position',
  'vehicle-attack-settler',
  'vehicle-attack-building',
  'vehicle-attack-vehicle',
  'vehicle-carrier',
]);

export interface PickModeDeps {
  readonly snapshot: () => WorldSnapshot;
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
  readonly setArmedCursor: (armed: boolean) => void;
  /** The sim's attach rule (`Simulation.canAttachToVehicle`), which the "Assign Vehicle" pick lights
   *  the settler's own vehicles by; absent, the pick lights nothing. */
  readonly canAttachToVehicle?: ((settler: number, vehicle: number) => boolean) | undefined;
}

/**
 * What a press did to an armed mode, for the caller's click feedback: `ordered` placed the order,
 * `missed` found no target under the press (approximation: the original keeps its tool armed after a
 * miss, this drops it), `calledOff` was any other button. Null when no mode was armed.
 */
export type PickPress = 'ordered' | 'missed' | 'calledOff';

/** The GUI click a pick press answers with: an order confirms, a call-off fails, a miss is silent. */
export function pickPressCue(press: PickPress): UiCue | null {
  switch (press) {
    case 'ordered':
      return 'confirm';
    case 'calledOff':
      return 'fail';
    case 'missed':
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
  signpostActive(): boolean;
  /** The ship whose dock pick is armed, or null: the frame loop washes the map with its mooring spots. */
  dockVehicle(): number | null;
  /** Non-null when a mode was armed: the press resolved or cancelled it, so the caller must not fall
   *  through to selection or an order. */
  handleMouseDown(event: MouseEvent): PickPress | null;
  /** A press on the map overview, which names the node `target` and nothing drawn there. A spot-target
   *  mode resolves; one that needs a picked unit or building stays armed, so scrolling the overview to
   *  find that target does not call it off. Non-null when the armed mode took the press. */
  handleOverviewPress(button: number, target: Tile): PickPress | null;
  /** The lit and dimmed pick targets of the armed mode: a building pick's candidate buildings, the
   *  "Assign Vehicle" pick's own vehicles. Null when the armed mode lights nothing. */
  highlight(): readonly BuildingHighlightItem[] | null;
}

/** The settler's owner's vehicles, green where the sim's attach rule takes the settler, red otherwise. */
function computeVehicleHighlight(
  snapshot: WorldSnapshot,
  settler: number,
  canAttach: (settler: number, vehicle: number) => boolean,
): BuildingHighlightItem[] {
  const self = entityById(snapshot, settler);
  const owner = self === undefined ? undefined : ownerPlayerOf(self);
  if (owner === undefined) return [];
  const items: BuildingHighlightItem[] = [];
  for (const e of snapshot.entities) {
    if (!isVehicle(e) || ownerPlayerOf(e) !== owner) continue;
    items.push({ id: e.id, ok: canAttach(settler, e.id) });
  }
  return items;
}

export function createPickModeController(deps: PickModeDeps): PickModeController {
  const buildingsByType = lastByTypeId(deps.content.buildings);
  let pickMode: PickMode | null = null;
  let pickVersion = 0;
  const setMode = (next: PickMode | null): void => {
    pickMode = next;
    pickVersion++;
    deps.setArmedCursor(next !== null && CROSSHAIR_MODES.has(next.kind));
  };
  const cancel = (): void => setMode(null);

  const resolveBuilding = (
    event: MouseEvent,
    kind: BuildingPickKind,
    settlers: readonly number[],
  ): boolean => {
    const w = deps.toWorld(event.clientX, event.clientY);
    const candidates = kind === 'trade-house' ? deps.targets.buildings() : deps.targets.owned('building');
    const building = pickTopAt(candidates, w.x, w.y);
    if (building === null) return false;
    const snapshot = deps.snapshot();
    if (kind === 'learning-place') {
      const learners = settlers.filter((settler) =>
        schoolPick.assignableAt(snapshot, building, settler, buildingsByType),
      );
      if (learners.length > 0) return deps.orders().openSchool(building, learners);
    }
    const orders = BUILDING_PICKS[kind].orders(snapshot, settlers, building, buildingsByType);
    for (const order of orders) deps.enqueue(order);
    return orders.length > 0;
  };

  const resolveSpot = (mode: SpotMode, named: Tile): boolean => {
    const { width, height } = nodeBounds(deps.mapSize);
    const target = clampTile(named, width, height);
    switch (mode.kind) {
      case 'destination':
        return deps.orders().issueMoveTo(target, mode.units);
      case 'work-area':
        return deps.orders().issueSetWorkFlag(target, mode.units);
      case 'attack-move': {
        const marched = mode.units.length > 0 && deps.orders().issueAttackMove(target, mode.units);
        const marchedVehicles =
          mode.vehicles.length > 0 && deps.vehicleOrders().issueAttackMove(mode.vehicles, target);
        return marched || marchedVehicles;
      }
      // Named deviation from the observed original, which erects with a right-click on lit ground: this
      // places with a left-click and dims blocked ground, matching build placement.
      case 'signpost':
        deps.enqueue({
          kind: 'placeSignpost',
          entity: mode.scout as Entity,
          x: target.col,
          y: target.row,
        });
        return true;
      // The explore order centres the scout's sweep on the named spot, as the original does.
      case 'explore':
        deps.enqueue({
          kind: 'exploreArea',
          entity: mode.scout as Entity,
          x: target.col,
          y: target.row,
        });
        return true;
      case 'vehicle-destination':
        return deps.vehicleOrders().issueMoveTo(mode.vehicle, target);
      case 'vehicle-dock':
        return deps.vehicleOrders().issueDock(mode.vehicle, target);
      case 'vehicle-attack-position':
        return deps.vehicleOrders().issueAttackPosition(mode.vehicle, target);
      default: {
        const unreachable: never = mode;
        throw new Error(`unhandled spot pick mode: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  const resolvePicked = (mode: Exclude<PickMode, SpotMode>, event: MouseEvent): boolean => {
    switch (mode.kind) {
      case 'workplace':
      case 'home':
      case 'building-site':
      case 'learning-place':
      case 'trade-house':
        return resolveBuilding(event, mode.kind, mode.units);
      case 'attack-settler':
        return deps.orders().issueAttackTarget(event, 'settler', mode.units);
      case 'attack-building':
        return deps.orders().issueAttackTarget(event, ['building', 'palisade'], mode.units);
      case 'attack-animal':
        return deps.orders().issueAttackAnimal(event, mode.units);
      case 'attack-vehicle':
        return deps.orders().issueAttackTarget(event, 'vehicle', mode.units);
      case 'vehicle':
        return deps.vehicleOrders().issueAttach(event, mode.settler);
      case 'vehicle-attack-settler':
        return deps.vehicleOrders().issueAttackTarget(event, mode.vehicle, 'settler');
      case 'vehicle-attack-building':
        return deps.vehicleOrders().issueAttackTarget(event, mode.vehicle, 'building');
      case 'vehicle-attack-vehicle':
        return deps.vehicleOrders().issueAttackTarget(event, mode.vehicle, 'vehicle');
      case 'vehicle-carrier':
        return deps.vehicleOrders().issueLoadInto(event, mode.vehicle);
      default: {
        const unreachable: never = mode;
        throw new Error(`unhandled pick mode: ${JSON.stringify(unreachable)}`);
      }
    }
  };

  const pressOutcome = (ordered: boolean): PickPress => (ordered ? 'ordered' : 'missed');

  const handleMouseDown = (event: MouseEvent): PickPress | null => {
    const mode = pickMode;
    if (mode === null) return null;
    // A selection change cancels any armed mode, so the selection read at click time is still the one
    // this mode was armed for.
    cancel();
    if (event.button !== 0) return 'calledOff'; // any other button just calls the mode off
    if (isSpotMode(mode)) return pressOutcome(resolveSpot(mode, deps.nodeAt(event.clientX, event.clientY)));
    return pressOutcome(resolvePicked(mode, event));
  };

  const handleOverviewPress = (button: number, target: Tile): PickPress | null => {
    const mode = pickMode;
    if (mode === null) return null;
    if (button !== 0) {
      cancel(); // any other button just calls the mode off
      return 'calledOff';
    }
    if (!isSpotMode(mode)) return null;
    cancel();
    return pressOutcome(resolveSpot(mode, target));
  };

  /** Read every frame, so the O(entities) pass is memoized on everything it reads: the snapshot instance
   *  plus `pickVersion`, which every arm and cancel bumps. */
  const highlightFor = memoBySnapshot(
    (snapshot: WorldSnapshot) => {
      const mode = pickMode;
      if (mode === null) return null;
      if (mode.kind === 'vehicle') {
        const canAttach = deps.canAttachToVehicle;
        return canAttach === undefined ? null : computeVehicleHighlight(snapshot, mode.settler, canAttach);
      }
      // The other picks show on the ground or the cursor.
      if (!isBuildingPick(mode)) return null;
      return BUILDING_PICKS[mode.kind].highlight(snapshot, mode.units, buildingsByType);
    },
    () => pickVersion,
  );

  return {
    arm: setMode,
    cancel,
    isArmed: () => pickMode !== null,
    signpostActive: () => pickMode?.kind === 'signpost',
    dockVehicle: () => (pickMode?.kind === 'vehicle-dock' ? pickMode.vehicle : null),
    handleMouseDown,
    handleOverviewPress,
    highlight: () => highlightFor(deps.snapshot()),
  };
}
