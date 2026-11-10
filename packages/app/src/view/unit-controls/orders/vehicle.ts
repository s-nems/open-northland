import type { ContentSet } from '@open-northland/data';
import { type OrderMarkerKind, type TargetFlashTone, tileToScreen } from '@open-northland/render';
import {
  type Entity,
  entityById,
  hexDistanceBetween,
  MAX_UNIT_ORDER_MEMBERS,
  nodeOfPosition,
  ONE,
  type PlayerCommand,
  positionedWithin,
  positionOfNode,
  systems,
  type TileBox,
  type WorldSnapshot,
} from '@open-northland/sim';
import { isVehicle, positionOf, type SnapshotEntity } from '../../../game/snapshot/index.js';
import type { ViewerSeat } from '../../../game/viewer-seat.js';
import { clampTile, nodeBounds, type Tile } from '../../picking.js';
import { enemyAt, ownSettlerAt, ownVehicleAt } from '../pick-targets.js';
import {
  type AttachPlan,
  isMooredShip,
  rightClickShips as rightClickShipsOf,
  type ShipPinPlan,
  selectedVehicle as selectedVehicleOf,
  selectedVehicles as selectedVehiclesOf,
  isShip as shipIn,
  isSiege as siegeIn,
  type VehicleGroup,
  type VehiclePlan,
  vehicleTypeOf as vehicleTypeIn,
} from '../right-click/vehicles.js';
import type { UnitTargetKind, UnitTargets } from '../unit-targets.js';
import type { AnsweredOrders } from './answered.js';
import {
  type Berth,
  type BerthShip,
  berthReach,
  DOCK_PICK_SNAP_NODES,
  type Hull,
  hullSpacing,
  type MooringRule,
  planBerths,
  RIGHT_CLICK_SNAP_NODES,
} from './berths.js';
import { type FormationUnit, formationTiles, pairFormation } from './formation.js';
import { enqueueArmyOrder, enqueueUnitSelection } from './group.js';
import { afterClickAnswer, type PendingGroundOrders } from './pending-ground.js';

/** How far apart a group's goals lie: past a catapult's footprint disc (`logicsize 1`) and a lane
 *  beside it, so no two marched vehicles contend for one goal. A group with a ship spaces its goals
 *  as far apart as a fleet's berths ({@link hullSpacing}), so the hulls sail and arrive apart. */
const VEHICLE_FORMATION_SPACING_NODES = 4;

export interface VehicleOrderDeps {
  readonly onOrderLimit?: (() => void) | undefined;
  readonly selected: () => ReadonlySet<number>;
  readonly targets: UnitTargets;
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  readonly mapSize: { readonly width: number; readonly height: number };
  /** Whose vehicles the orders command: the viewer seat's, or any when the viewer watches the whole map. */
  readonly viewer: ViewerSeat;
  readonly toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  readonly enqueue: (command: PlayerCommand) => void;
  /** The sim's attach rule, asked as the click lands; absent, every own vehicle under the cursor takes
   *  the attach click. */
  readonly askAttachToVehicle?: ((settler: number, vehicle: number) => Promise<boolean>) | undefined;
  /** The sim's pin rule, asked as the click lands; absent, a right click resolves no pin. */
  readonly askPinTradeShip?: ((trader: number, ship: number) => Promise<boolean>) | undefined;
  /** A ship's mooring rule (`SessionHost.mooringProbe`), asked as the click lands; absent, the dock
   *  click moors where it lands and a ship's right-click is always a goto. */
  readonly askMooring?: ((vehicle: number) => Promise<MooringRule | null>) | undefined;
  /** The same rule's last answer, which the berth preview under the cursor reads; undefined while it is
   *  being answered. */
  readonly mooring?: ((vehicle: number) => MooringRule | null | undefined) | undefined;
  /** Where the orders a host answer decides wait for it. */
  readonly answered: AnsweredOrders;
  /** Puts a mooring answer's order in click order among the vehicle's other orders: a Shift click waits
   *  for the earlier clicks of the same ship, and a newer plain order calls an unanswered one off. Absent,
   *  the order applies as its answer lands. */
  readonly pendingGroundOrders?: PendingGroundOrders | undefined;
  /** Acknowledges a drive, mooring or bombardment on the ground where it was aimed; absent, nothing is
   *  drawn. */
  readonly markOrder?: ((node: Tile, kind: OrderMarkerKind) => void) | undefined;
  /** Flashes an order's target once; absent, nothing is drawn. */
  readonly flashTarget?: ((entity: number, tone: TargetFlashTone) => void) | undefined;
}

/**
 * The orders a selected vehicle takes from the world view: the right-click defaults and the resolutions
 * of the vehicle window's armed picks. Every order reports whether it commanded the vehicle, for the
 * caller's click feedback.
 */
export interface VehicleOrderController {
  /** The owned siege vehicles selected themselves, the ones an attack-move marches. */
  selectedSiegeVehicles(): number[];
  /** The owned vehicles selected themselves, the ones a right click drives. */
  selectedOwnVehicles(): number[];
  /** Issues the vehicles' part of a resolved right click (`resolveVehicleRightClick`). A `queued` attack,
   *  load, drive or dock waits behind each vehicle's current order. */
  issueVehiclePlan(plan: VehiclePlan, queued: boolean): boolean;
  /** A `queued` order waits behind the vehicle's current one (`VehicleOrderQueue`). */
  issueMoveTo(vehicle: number, target: Tile, queued?: boolean): boolean;
  /** Drive the selection's vehicles to `target` as a right-click on open ground does: one vehicle drives
   *  there, or docks where a ship's mooring rule accepts the shore, and a group drives in formation. */
  issueDriveTo(target: Tile, queued?: boolean): boolean;
  /** March `vehicles` to `target`, each to its own slot of a spaced formation around it, fighting
   *  whatever they meet on the way. */
  issueAttackMove(vehicles: readonly number[], target: Tile, queued?: boolean): boolean;
  /** Moor `ships` along the shore their mooring rules accept nearest `target`, each at its own berth,
   *  within the dock pick's loose aim; a spot with no such shore near it orders nothing. `lands` lands
   *  each ship's crew once it moors. */
  issueDock(ships: readonly number[], target: Tile, queued?: boolean, lands?: boolean): boolean;
  /** Where `ships` would moor for a dock order aimed at `target` within `snap` nodes, read off the
   *  mooring rules' last answers: the berths the cursor previews. Empty while a rule is being answered. */
  previewBerths(ships: readonly number[], target: Tile, snap: number): readonly Berth[];
  /** The selection's ships a right-click docks: the one selected ship, or a group's ships. */
  rightClickShips(): number[];
  issueAttackPosition(vehicle: number, target: Tile, queued?: boolean): boolean;
  /** Aim `vehicle` at the enemy of `kind` under the cursor; a click that hits none orders nothing. */
  issueAttackTarget(event: MouseEvent, vehicle: number, kind: UnitTargetKind, queued?: boolean): boolean;
  /** Load `vehicle` into the own ship under the cursor. */
  issueLoadInto(event: MouseEvent, vehicle: number, queued?: boolean): boolean;
  /** Attach `settler` to the own vehicle under the cursor (the ring's "Assign Vehicle") once the attach
   *  rule admits it; a vehicle it refuses orders nothing, the way a red building cancels a building
   *  pick. A `queued` attach waits behind the settler's current order. */
  issueAttach(event: MouseEvent, settler: number, queued?: boolean): boolean;
  /** The same attach from the vehicle's side: the own settler under the cursor takes a seat on
   *  `vehicle`, the commander's first. */
  issueSeatRider(event: MouseEvent, vehicle: number, queued?: boolean): boolean;
  /** Drive the own land vehicle under the cursor onto `ship`'s deck. */
  issueDeckLoad(event: MouseEvent, ship: number, queued?: boolean): boolean;
  /** Whether `vehicle` may be loaded into `carrier`: one of our moored ships other than itself. */
  loadsInto(vehicle: number, carrier: number): boolean;
  /** Issues the selected settlers' resolved boarding (`resolveAttachSelected`), each one the attach rule
   *  admits taking a seat. `onNoneBoards` runs once the rule refused every one, so the click can take its
   *  usual order instead. A `queued` attach waits behind each settler's current order. */
  issueAttachPlan(plan: AttachPlan, queued: boolean, onNoneBoards: () => void): boolean;
  /** Issues a lone trader's resolved pin (`resolveShipPin`): a pinned ship is let go at once, any other
   *  is pinned once the sim admits it. `onSet` runs when the pin changed, `onRefused` when the sim turned
   *  the ship down, and neither once a newer order took the trader. */
  issueShipPin(plan: ShipPinPlan, onSet: () => void, onRefused: () => void): void;
}

export function createVehicleOrderController(deps: VehicleOrderDeps): VehicleOrderController {
  const context = () => ({ snapshot: deps.snapshot(), content: deps.content, viewer: deps.viewer });
  const vehicleTypeOf = (e: SnapshotEntity) => vehicleTypeIn(deps.content, e);
  const isShip = (e: SnapshotEntity): boolean => shipIn(deps.content, e);
  const selectedVehicle = (): number | null => selectedVehicleOf(context(), deps.selected());
  const selectedVehicles = (): SnapshotEntity[] => selectedVehiclesOf(context(), deps.selected());
  const selectedOwnVehicles = (): number[] => selectedVehicles().map((e) => e.id);
  const selectedSiegeVehicles = (): number[] =>
    selectedVehicles()
      .filter((e) => siegeIn(deps.content, e))
      .map((e) => e.id);

  const clampNode = (target: Tile): Tile => {
    const { width, height } = nodeBounds(deps.mapSize);
    return clampTile(target, width, height);
  };

  /** `ships` as the berth planner reads them, each with its rule; a ship off the map, or one whose rule
   *  has no answer or takes no dock order, is left out. */
  const berthShips = (
    ships: readonly number[],
    rules: readonly (MooringRule | null | undefined)[],
  ): BerthShip[] => {
    const snapshot = deps.snapshot();
    const out: BerthShip[] = [];
    ships.forEach((vehicle, i) => {
      const rule = rules[i];
      const e = entityById(snapshot, vehicle);
      const position = e === undefined ? undefined : positionOf(e);
      const type = e === undefined ? undefined : vehicleTypeOf(e);
      const doorDistance = type?.passengerVector?.distance;
      if (rule === null || rule === undefined || position === undefined || type === undefined) return;
      if (doorDistance === undefined) return;
      const { hx, hy } = nodeOfPosition(position.x, position.y);
      out.push({ vehicle, at: { col: hx, row: hy }, logicSize: type.logicSize, doorDistance, rule });
    });
    return out;
  };

  /** The ships outside `fleet` within `radius` nodes of `around`, whose hulls a berth keeps clear of. */
  const hullsNear = (fleet: readonly BerthShip[], around: Tile, radius: number): Hull[] => {
    const low = positionOfNode(around.col - radius, around.row - radius);
    const high = positionOfNode(around.col + radius, around.row + radius);
    const box: TileBox = { minX: low.x / ONE, minY: low.y / ONE, maxX: high.x / ONE, maxY: high.y / ONE };
    const hulls: Hull[] = [];
    for (const e of positionedWithin(deps.snapshot(), box, [])) {
      if (!isVehicle(e) || !isShip(e) || fleet.some((ship) => ship.vehicle === e.id)) continue;
      const position = positionOf(e);
      const type = vehicleTypeOf(e);
      if (position === undefined || type === undefined) continue;
      const { hx, hy } = nodeOfPosition(position.x, position.y);
      if (hexDistanceBetween(around.col, around.row, hx, hy) <= radius)
        hulls.push({ at: { col: hx, row: hy }, logicSize: type.logicSize });
    }
    return hulls;
  };

  /** The hulls outside `fleet` in the water its berths around `at` may spread over. */
  const othersAround = (fleet: readonly BerthShip[], at: Tile, snap: number): Hull[] => {
    const door = Math.max(0, ...fleet.map((ship) => ship.doorDistance + ship.logicSize));
    return hullsNear(fleet, at, snap + berthReach(fleet) + door);
  };

  const planFor = (fleet: readonly BerthShip[], target: Tile, snap: number): Berth[] => {
    const at = clampNode(target);
    return planBerths(fleet, at, snap, othersAround(fleet, at, snap));
  };

  /** Ask every ship's mooring rule as the click lands, then plan their berths around `target`. */
  const afterBerths = (
    ask: NonNullable<VehicleOrderDeps['askMooring']>,
    ships: readonly number[],
    target: Tile,
    snap: number,
    queued: boolean,
    then: (berths: readonly Berth[], current: (actor: number) => boolean) => void,
  ): void =>
    afterAnswer(ships, queued, Promise.all(ships.map((ship) => ask(ship))), (rules, current) =>
      then(planFor(berthShips(ships, rules), target, snap), current),
    );

  let previewKey = '';
  let preview: readonly Berth[] = [];
  const previewBerths = (fleet: readonly number[], target: Tile, snap: number): readonly Berth[] => {
    const read = deps.mooring;
    if (read === undefined || fleet.length === 0) return [];
    const rules = fleet.map(read);
    // Planned once every rule has answered, for the ships whose rule takes a dock order, as the click is.
    if (rules.includes(undefined)) return [];
    const planned = berthShips(fleet, rules);
    const at = clampNode(target);
    const others = othersAround(planned, at, snap);
    const ships = planned.map((ship) => `${ship.vehicle}@${ship.at.col},${ship.at.row}/${ship.rule.key}`);
    const hulls = others.map((hull) => `${hull.at.col},${hull.at.row}`);
    const key = `${at.col},${at.row}:${snap}:${ships.join(';')}:${hulls.join(';')}`;
    if (key !== previewKey) {
      previewKey = key;
      preview = planBerths(planned, at, snap, others);
    }
    return preview;
  };

  const rightClickShips = (): number[] => rightClickShipsOf(context(), deps.selected());

  const issueMoveTo = (vehicle: number, target: Tile, queued = false): boolean => {
    const node = clampNode(target);
    deps.enqueue({
      kind: 'moveVehicle',
      vehicle: vehicle as Entity,
      x: node.col,
      y: node.row,
      ...(queued ? { queued } : {}),
    });
    deps.markOrder?.(node, 'move');
    return true;
  };

  const afterAnswer = <T>(
    actors: readonly number[],
    queued: boolean,
    answer: Promise<T>,
    then: (value: T, current: (actor: number) => boolean) => void,
  ): void => afterClickAnswer(deps.pendingGroundOrders, deps.answered, actors, queued, answer, then);

  /** The node distance between a group's goals: the fleet spacing of its widest ship, or the plain
   *  vehicle spacing for a group with no ship. */
  const formationSpacing = (vehicles: readonly number[]): number => {
    const snapshot = deps.snapshot();
    let spacing = VEHICLE_FORMATION_SPACING_NODES;
    for (const vehicle of vehicles) {
      const e = entityById(snapshot, vehicle);
      const type = e === undefined || !isShip(e) ? undefined : vehicleTypeOf(e);
      if (type !== undefined) spacing = Math.max(spacing, hullSpacing(type.logicSize));
    }
    return spacing;
  };

  /** One goal per vehicle around `target`: formation slots on a lattice as wide as the group, scaled out
   *  to the group's spacing, each paired with the vehicle nearest it so courses keep the group's layout
   *  instead of crossing. A vehicle standing nowhere takes a slot the paired ones left, in order. */
  const formationGoals = (vehicles: readonly number[], target: Tile): Tile[] => {
    const count = vehicles.length;
    const spacing = formationSpacing(vehicles);
    const slots = formationTiles(
      { col: count, row: count },
      count,
      2 * count + 1,
      2 * count + 1,
      () => false,
    ).map((slot) =>
      clampNode({
        col: target.col + (slot.col - count) * spacing,
        row: target.row + (slot.row - count) * spacing,
      }),
    );
    const snapshot = deps.snapshot();
    const units: FormationUnit[] = [];
    for (const vehicle of vehicles) {
      const e = entityById(snapshot, vehicle);
      const position = e === undefined ? undefined : positionOf(e);
      if (position !== undefined)
        units.push({ ref: vehicle, ...tileToScreen(position.x / ONE, position.y / ONE) });
    }
    const paired = new Map(pairFormation(units, target, slots).map((order) => [order.ref, order.tile]));
    let spare = units.length;
    return vehicles.map((vehicle) => paired.get(vehicle) ?? slots[spare++] ?? clampNode(target));
  };

  const driveInFormation = (
    vehicles: readonly number[],
    target: Tile,
    attackMove: boolean,
    queued: boolean,
  ): boolean => {
    if (vehicles.length === 0) return false;
    if (vehicles.length > MAX_UNIT_ORDER_MEMBERS) {
      deps.onOrderLimit?.();
      return false;
    }
    const goals = formationGoals(vehicles, target);
    const accepted = enqueueArmyOrder(
      {
        kind: 'moveVehicleGroup',
        members: vehicles.map((vehicle, i) => {
          const node = goals[i] ?? clampNode(target);
          return { entity: vehicle as Entity, x: node.col, y: node.row };
        }),
        ...(attackMove ? { attackMove: true } : {}),
        ...(queued ? { queued: true } : {}),
      },
      deps.enqueue,
      deps.onOrderLimit,
    );
    if (accepted) deps.markOrder?.(clampNode(target), attackMove ? 'attack' : 'move');
    return accepted;
  };

  const issueAttackMove = (vehicles: readonly number[], target: Tile, queued = false): boolean =>
    driveInFormation(vehicles, target, true, queued);

  /** `at`, a dock node of the point's ring, is where the hull lies; absent, the sim takes its ring's first.
   *  `lands` queues the ship's unload behind the dock, so the crew steps ashore once it moors. */
  const dock = (vehicle: number, node: Tile, queued: boolean, lands: boolean, at?: Tile): void => {
    deps.enqueue({
      kind: 'dockVehicle',
      vehicle: vehicle as Entity,
      x: node.col,
      y: node.row,
      ...(at === undefined ? {} : { dock: { x: at.col, y: at.row } }),
      ...(queued ? { queued } : {}),
    });
    if (lands) {
      const mooring = { x: node.col, y: node.row };
      deps.enqueue({
        kind: 'unloadPeople',
        vehicle: vehicle as Entity,
        queued: true,
        mooring,
        keepCommander: true,
      });
    }
    deps.markOrder?.(node, 'move');
  };

  const dockAt = (
    berths: readonly Berth[],
    current: (actor: number) => boolean,
    queued: boolean,
    lands = false,
  ): void => {
    for (const berth of berths)
      if (current(berth.vehicle)) dock(berth.vehicle, berth, queued, lands, berth.dock);
  };

  const issueDock = (ships: readonly number[], target: Tile, queued = false, lands = false): boolean => {
    if (ships.length === 0) return false;
    if (ships.length > MAX_UNIT_ORDER_MEMBERS) {
      deps.onOrderLimit?.();
      return false;
    }
    const ask = deps.askMooring;
    if (ask === undefined) for (const ship of ships) dock(ship, clampNode(target), queued, lands);
    else
      afterBerths(ask, ships, target, DOCK_PICK_SNAP_NODES, queued, (berths, current) =>
        dockAt(berths, current, queued, lands),
      );
    return true;
  };

  const issueAttackPosition = (vehicle: number, target: Tile, queued = false): boolean => {
    const node = clampNode(target);
    deps.enqueue({
      kind: 'attackWithVehicle',
      vehicle: vehicle as Entity,
      target: { kind: 'ground', hx: node.col, hy: node.row },
      ...(queued ? { queued } : {}),
    });
    deps.markOrder?.(node, 'attack');
    return true;
  };

  const strike = (vehicle: number, enemy: number, queued: boolean): boolean => {
    deps.enqueue({
      kind: 'attackWithVehicle',
      vehicle: vehicle as Entity,
      target: { kind: 'entity', entity: enemy as Entity },
      ...(queued ? { queued } : {}),
    });
    deps.flashTarget?.(enemy, 'attack');
    return true;
  };

  const issueAttackTarget = (
    event: MouseEvent,
    vehicle: number,
    kind: UnitTargetKind,
    queued = false,
  ): boolean => {
    const enemy = enemyAt(deps.targets, deps.toWorld(event.clientX, event.clientY), [kind]);
    return enemy !== null && strike(vehicle, enemy, queued);
  };

  const loadsInto = (vehicle: number, carrier: number): boolean =>
    vehicle !== carrier && isMooredShip(context(), carrier);

  const loadInto = (vehicle: number, carrier: number, queued = false): boolean => {
    if (!loadsInto(vehicle, carrier)) return false;
    deps.enqueue({
      kind: 'loadIntoVehicle',
      vehicle: vehicle as Entity,
      carrier: carrier as Entity,
      ...(queued ? { queued } : {}),
    });
    deps.flashTarget?.(carrier, 'order');
    return true;
  };

  const issueLoadInto = (event: MouseEvent, vehicle: number, queued = false): boolean => {
    const carrier = ownVehicleAt(deps.targets, deps.toWorld(event.clientX, event.clientY));
    return carrier !== null && loadInto(vehicle, carrier, queued);
  };

  const issueAttach = (event: MouseEvent, settler: number, queued = false): boolean => {
    const vehicle = ownVehicleAt(deps.targets, deps.toWorld(event.clientX, event.clientY));
    if (vehicle === null) return false;
    return attachWhenAdmitted([settler], vehicle, () => undefined, queued);
  };

  /** Attach each of `settlers` the rule admits, once it answered, in click order among their other
   *  pending clicks; `onNone` when it admitted nobody. A `group` order lets the sim seat the ones riding
   *  nothing first, as a building's group order does; a queued one attaches each settler in its turn. */
  const attachWhenAdmitted = (
    settlers: readonly number[],
    vehicle: number,
    onNone: () => void,
    queued: boolean,
    group = false,
  ): boolean => {
    if (settlers.length > MAX_UNIT_ORDER_MEMBERS) {
      deps.onOrderLimit?.();
      return false;
    }
    const attach = (recipients: readonly number[]): boolean => {
      if (recipients.length === 0) return false;
      if (group && !queued) {
        const members = recipients.map((entity) => ({ entity: entity as Entity }));
        deps.enqueue({ kind: 'attachToVehicleGroup', vehicle: vehicle as Entity, members });
        deps.flashTarget?.(vehicle, 'order');
        return true;
      }
      const sent = enqueueUnitSelection(
        recipients.map((entity) => ({
          kind: 'attachToVehicle',
          entity: entity as Entity,
          vehicle: vehicle as Entity,
          ...(queued ? { queued } : {}),
        })),
        deps.enqueue,
        deps.onOrderLimit,
      );
      if (sent) deps.flashTarget?.(vehicle, 'order');
      return sent;
    };
    const ask = deps.askAttachToVehicle;
    if (ask === undefined) {
      return attach(settlers);
    }
    afterAnswer(
      settlers,
      queued,
      Promise.all(settlers.map((settler) => ask(settler, vehicle))),
      (verdicts, current) => {
        // Only the rule's refusal hands the click on: a settler a newer order took is no one's to replay.
        const admitted = settlers.filter((_settler, index) => verdicts[index] === true);
        attach(admitted.filter(current));
        if (admitted.length === 0) onNone();
      },
    );
    return true;
  };

  const issueSeatRider = (event: MouseEvent, vehicle: number, queued = false): boolean => {
    const settler = ownSettlerAt(deps.targets, deps.toWorld(event.clientX, event.clientY));
    if (settler === null) return false;
    return attachWhenAdmitted([settler], vehicle, () => undefined, queued);
  };

  const issueDeckLoad = (event: MouseEvent, ship: number, queued = false): boolean => {
    const vehicle = ownVehicleAt(deps.targets, deps.toWorld(event.clientX, event.clientY), ship);
    return vehicle !== null && loadInto(vehicle, ship, queued);
  };

  const issueAttachPlan = (plan: AttachPlan, queued: boolean, onNoneBoards: () => void): boolean =>
    attachWhenAdmitted(plan.settlers, plan.vehicle, onNoneBoards, queued, true);

  const issueShipPin = (
    { trader, ship, unpins }: ShipPinPlan,
    onSet: () => void,
    onRefused: () => void,
  ): void => {
    const entity = trader as Entity;
    const ask = deps.askPinTradeShip;
    if (unpins) {
      deps.enqueue({ kind: 'setTradeShip', entity, ship: null });
      onSet();
    } else if (ask === undefined) {
      onRefused();
    } else {
      afterAnswer([trader], false, ask(trader, ship), (admitted, current) => {
        if (!current(trader)) return;
        if (!admitted) {
          onRefused();
          return;
        }
        deps.enqueue({ kind: 'setTradeShip', entity, ship: ship as Entity });
        deps.flashTarget?.(ship, 'assign');
        onSet();
      });
    }
  };

  const issueVehiclePlan = (plan: VehiclePlan, queued: boolean): boolean => {
    if (plan.kind === 'none') return false;
    if (plan.kind === 'orderLimit') {
      deps.onOrderLimit?.();
      return false;
    }
    for (const group of plan.groups) issueGroup(group, queued);
    return true;
  };

  const issueGroup = ({ vehicles, intent }: VehicleGroup, queued: boolean): void => {
    switch (intent.kind) {
      case 'strike':
        if (
          enqueueArmyOrder(
            {
              kind: 'attackWithVehicleGroup',
              members: vehicles.map((vehicle) => ({ entity: vehicle as Entity })),
              target: { kind: 'entity', entity: intent.enemy as Entity },
              ...(queued ? { queued: true } : {}),
            },
            deps.enqueue,
            deps.onOrderLimit,
          )
        )
          deps.flashTarget?.(intent.enemy, 'attack');
        return;
      case 'loadInto':
        for (const vehicle of vehicles) loadInto(vehicle, intent.carrier, queued);
        return;
      case 'drive':
        for (const vehicle of vehicles) driveTo(vehicle, intent.tile, queued, intent.lands);
        return;
      case 'driveFormation':
        driveInFormation(vehicles, intent.tile, false, queued);
        return;
      case 'dock': {
        const ask = deps.askMooring;
        if (ask === undefined) {
          driveInFormation(vehicles, intent.tile, false, queued);
          return;
        }
        // A ship the shore there has no berth for sails with the rest.
        afterBerths(ask, vehicles, intent.tile, RIGHT_CLICK_SNAP_NODES, queued, (berths, current) => {
          dockAt(berths, current, queued, intent.lands);
          const sailing = vehicles.filter(
            (ship) => current(ship) && !berths.some((berth) => berth.vehicle === ship),
          );
          if (sailing.length > 0) driveInFormation(sailing, intent.tile, false, queued);
        });
        return;
      }
    }
  };

  /** Drive `vehicle` to `target`: a ship docks at the shore its mooring rule, asked as the click lands,
   *  accepts within a right-click's reach of the target, and sails there otherwise. */
  const driveTo = (vehicle: number, target: Tile, queued: boolean, lands = false): boolean => {
    const self = entityById(deps.snapshot(), vehicle);
    const type = self === undefined ? undefined : vehicleTypeOf(self);
    const ask = deps.askMooring;
    if ((type !== undefined && !systems.isShipVehicle(type)) || ask === undefined) {
      return issueMoveTo(vehicle, target, queued);
    }
    afterBerths(ask, [vehicle], target, RIGHT_CLICK_SNAP_NODES, queued, (berths, current) => {
      if (!current(vehicle)) return;
      if (berths.length > 0) dockAt(berths, current, queued, lands);
      else issueMoveTo(vehicle, target, queued);
    });
    return true;
  };

  const issueDriveTo = (target: Tile, queued = false): boolean => {
    const vehicle = selectedVehicle();
    if (vehicle !== null) return driveTo(vehicle, target, queued);
    return driveInFormation(selectedOwnVehicles(), target, false, queued);
  };

  return {
    selectedSiegeVehicles,
    selectedOwnVehicles,
    issueVehiclePlan,
    issueMoveTo,
    issueDriveTo,
    issueAttackMove,
    issueDock,
    previewBerths,
    rightClickShips,
    issueAttackPosition,
    issueAttackTarget,
    issueLoadInto,
    issueAttach,
    issueSeatRider,
    issueDeckLoad,
    loadsInto,
    issueAttachPlan,
    issueShipPin,
  };
}
