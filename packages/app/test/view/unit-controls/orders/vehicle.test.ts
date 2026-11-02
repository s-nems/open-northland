import type { OrderMarkerKind, TargetFlashTone } from '@open-northland/render';
import {
  type Command,
  type Entity,
  fx,
  hexDistanceBetween,
  MAX_UNIT_ORDER_MEMBERS,
  type PlayerCommand,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import {
  sandboxContent,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_SMALL,
} from '../../../../src/game/sandbox/index.js';
import { fixedViewerSeat } from '../../../../src/game/viewer-seat.js';
import { type Pickable, type Tile, worldToTile } from '../../../../src/view/picking.js';
import { createAnsweredOrders } from '../../../../src/view/unit-controls/orders/answered.js';
import type { MooringRule } from '../../../../src/view/unit-controls/orders/berths.js';
import {
  createPendingGroundOrders,
  type PendingGroundOrders,
} from '../../../../src/view/unit-controls/orders/pending-ground.js';
import { issueRingCommand } from '../../../../src/view/unit-controls/orders/ring-commands.js';
import {
  createVehicleOrderController,
  type VehicleOrderController,
  type VehicleOrderDeps,
} from '../../../../src/view/unit-controls/orders/vehicle.js';
import { createPickModeController } from '../../../../src/view/unit-controls/pick-mode.js';
import { selectedVehicle } from '../../../../src/view/unit-controls/right-click/vehicles.js';
import { withPointHits } from '../../../support/point-hits.js';
import { rightClickAttach, rightClickVehicles } from '../../../support/right-click.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

/**
 * The right-click defaults of a selected vehicle and the picks the vehicle window arms. Every target sits
 * under one pixel, so only the order of the defaults decides what the click does.
 */

const CATAPULT = 10;
/** A second catapult's id; the formation reads no entity, so it needs none in the world. */
const SECOND_CATAPULT = 15;
const HANDCART = 11;
const SHIP = 12;
const SHIP_AT_SEA = 13;
const ENEMY_SOLDIER = 20;
const ENEMY_HOUSE = 21;
const ENEMY_CART = 22;
const OWN_SETTLER = 30;
/** The handcart's crew: both aboard, so neither stands anywhere on the map. */
const CART_COMMANDER = 31;
const CART_PASSENGER = 32;
/** A cart riding inside the moored ship and the commander aboard it: nothing to drive on the map. */
const CARRIED_CART = 14;
const CARRIED_COMMANDER = 33;
const SHIP_COMMANDER = 34;
const SEA_COMMANDER = 35;
const ENEMY_PLAYER = 1;
/** Boarding candidates, numbered from an id no other fixture entity takes. */
const BOARDING_GROUP = 3;
const FIRST_CANDIDATE = 100;

const CLICK = { x: 100, y: 100 };
const MAP_SIZE = { width: 16, height: 16 };

const at = (col: number, row: number): { x: number; y: number } => ({
  x: fx.fromInt(col),
  y: fx.fromInt(row),
});

const vehicle = (
  id: number,
  vehicleType: number,
  player: number,
  moored = false,
  passengers: ReadonlyArray<{ entity: number; inside: boolean } | null> = [],
  carrier: number | null = null,
  standsAt = at(2, 2),
): Ent => ({
  id,
  components: {
    Vehicle: { vehicleType, tribe: 1, moored, passengers, vehicles: [], carrier },
    Owner: { player },
    ...(carrier === null ? { Position: standsAt } : {}), // a carried vehicle stands nowhere on the map
  },
});

/** A settler aboard `vehicle`: a `Rider` with no `Position`. */
const aboard = (id: number, vehicle: number): Ent => ({
  id,
  components: {
    Settler: { jobType: null },
    Owner: { player: HUMAN_PLAYER },
    Rider: { vehicle, boarding: false },
  },
});

const WORLD: WorldSnapshot = snapshotOf([
  vehicle(CATAPULT, VEHICLE_CATAPULT, HUMAN_PLAYER),
  vehicle(HANDCART, VEHICLE_HANDCART, HUMAN_PLAYER, false, [
    { entity: CART_PASSENGER, inside: true },
    { entity: CART_COMMANDER, inside: true },
  ]),
  aboard(CART_COMMANDER, HANDCART),
  aboard(CART_PASSENGER, HANDCART),
  vehicle(
    CARRIED_CART,
    VEHICLE_HANDCART,
    HUMAN_PLAYER,
    false,
    [{ entity: CARRIED_COMMANDER, inside: true }],
    SHIP,
  ),
  aboard(CARRIED_COMMANDER, CARRIED_CART),
  vehicle(SHIP, VEHICLE_SHIP_SMALL, HUMAN_PLAYER, true, [{ entity: SHIP_COMMANDER, inside: true }]),
  aboard(SHIP_COMMANDER, SHIP),
  // Out at sea, clear of the water the moored ship docks in.
  vehicle(
    SHIP_AT_SEA,
    VEHICLE_SHIP_SMALL,
    HUMAN_PLAYER,
    false,
    [{ entity: SEA_COMMANDER, inside: true }],
    null,
    at(12, 12),
  ),
  aboard(SEA_COMMANDER, SHIP_AT_SEA),
  vehicle(ENEMY_CART, VEHICLE_HANDCART, ENEMY_PLAYER),
  {
    id: ENEMY_SOLDIER,
    components: { Settler: { jobType: null }, Owner: { player: ENEMY_PLAYER }, Position: at(3, 3) },
  },
  {
    id: ENEMY_HOUSE,
    components: { Building: { buildingType: 1 }, Owner: { player: ENEMY_PLAYER }, Position: at(4, 4) },
  },
  {
    id: OWN_SETTLER,
    components: { Settler: { jobType: null }, Owner: { player: HUMAN_PLAYER }, Position: at(5, 5) },
  },
]);

/** The world as the right click's vehicle reads see it. */
const VIEW = { snapshot: WORLD, content: sandboxContent(), viewer: fixedViewerSeat(HUMAN_PLAYER) };

const under = (ref: number, kind: NonNullable<Pickable['kind']>): Pickable => ({ ref, ...CLICK, kind });

interface Arms {
  readonly enemies?: readonly Pickable[];
  readonly vehicles?: readonly Pickable[];
  /** The sim's vehicle rules, absent by default: every spot moors and every own vehicle takes a rider. */
  readonly canMoorAt?: (vehicle: number, x: number, y: number) => boolean;
  readonly canAttachToVehicle?: (settler: number, vehicle: number) => boolean;
  readonly canPinTradeShip?: (trader: number, ship: number) => boolean;
  readonly pendingGroundOrders?: PendingGroundOrders;
  /** The selected settlers standing on the map, for the right-click attach. */
  readonly settlers?: readonly number[];
  /** Own settlers drawn under the cursor, which take the right-click ahead of a vehicle beneath them. */
  readonly settlersUnder?: readonly Pickable[];
}

const targetsOf = (arms: Arms) =>
  withPointHits({
    owned: (kind) =>
      kind === 'vehicle'
        ? [...(arms.vehicles ?? [])]
        : kind === 'settler'
          ? [...(arms.settlersUnder ?? [])]
          : [],
    buildings: () => [],
    enemies: () => [...(arms.enemies ?? [])],
    flags: () => [],
    signposts: () => [],
    chests: () => [],
    goods: () => [],
    resources: () => [],
    wildlife: () => [],
    claimableLivestock: () => [],
    ownedSettlersIn: () => (arms.settlers ?? []).map((ref) => ({ ref, x: 0, y: 0 })),
  });

/** A synchronous rule as the host answers it: a Promise, landing a microtask later. */
function answering<A extends unknown[]>(
  rule: ((...args: A) => boolean) | undefined,
): ((...args: A) => Promise<boolean>) | undefined {
  return rule === undefined ? undefined : (...args) => Promise.resolve(rule(...args));
}

/** A mooring rule as the host answers it: shore where `canMoorAt` says, open water everywhere else. */
function mooringOf(
  canMoorAt: Arms['canMoorAt'],
): ((vehicle: number) => Promise<MooringRule | null>) | undefined {
  return canMoorAt === undefined ? undefined : (vehicle) => Promise.resolve(shoreRule(vehicle, canMoorAt));
}

function shoreRule(vehicle: number, canMoorAt: NonNullable<Arms['canMoorAt']>): MooringRule {
  return {
    key: 'shore',
    moors: (x, y) => canMoorAt(vehicle, x, y),
    docks: (x, y) => !canMoorAt(vehicle, x, y),
  };
}

/** Let the answers a click waits on land. */
const landed = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function harness(selected: readonly number[], arms: Arms) {
  const issued: Command[] = [];
  const marked: [Tile, OrderMarkerKind][] = [];
  const flashed: [number, TargetFlashTone][] = [];
  const targets = targetsOf(arms);
  const deps = {
    answered: createAnsweredOrders(),
    selected: () => new Set(selected),
    targets,
    snapshot: () => WORLD,
    content: sandboxContent(),
    mapSize: MAP_SIZE,
    viewer: fixedViewerSeat(HUMAN_PLAYER),
    toWorld: (x, y) => ({ x, y }),
    enqueue: (command) => issued.push(command),
    askMooring: mooringOf(arms.canMoorAt),
    askAttachToVehicle: answering(arms.canAttachToVehicle),
    askPinTradeShip: answering(arms.canPinTradeShip),
    pendingGroundOrders: arms.pendingGroundOrders,
    markOrder: (node, kind) => marked.push([node, kind]),
    flashTarget: (entity, tone) => flashed.push([entity, tone]),
  } satisfies VehicleOrderDeps;
  const controller = createVehicleOrderController(deps);
  const click = (event: MouseEvent): boolean => rightClickVehicles(controller, deps, event);
  const attach = (event: MouseEvent, onNoneBoards: () => void): boolean =>
    rightClickAttach(controller, deps, event, onNoneBoards);
  const pickMode = createPickModeController({
    answered: createAnsweredOrders(),
    snapshot: () => WORLD,
    targets,
    content: sandboxContent(),
    mapSize: MAP_SIZE,
    toWorld: (x, y) => ({ x, y }),
    nodeAt: () => ({ col: 3, row: 3 }),
    enqueue: (command) => issued.push(command),
    orders: () => {
      throw new Error('no settler order controller in this test');
    },
    vehicleOrders: () => controller,
    setArmedCursor: () => undefined,
    canAttachToVehicle: arms.canAttachToVehicle,
  });
  return { issued, controller, click, attach, pickMode, marked, flashed };
}

/** Issues the lone trader's pin of the ship; the outcomes it reports land in the returned list. */
function pinOutcomes(controller: VehicleOrderController, unpins: boolean): string[] {
  const outcomes: string[] = [];
  controller.issueShipPin(
    { trader: OWN_SETTLER, ship: SHIP, unpins },
    () => outcomes.push('set'),
    () => outcomes.push('refused'),
  );
  return outcomes;
}

const rightClick = { clientX: CLICK.x, clientY: CLICK.y, button: 2 } as MouseEvent;
const leftClick = { clientX: CLICK.x, clientY: CLICK.y, button: 0 } as MouseEvent;

const ENEMIES_UNDER = [
  under(ENEMY_SOLDIER, 'settler'),
  under(ENEMY_HOUSE, 'building'),
  under(ENEMY_CART, 'vehicle'),
];
const ALL_UNDER: Arms = { enemies: ENEMIES_UNDER, vehicles: [under(SHIP, 'vehicle')] };

describe('vehicle right-click defaults', () => {
  it('sends an armed vehicle at an enemy human before anything else under the cursor', () => {
    const { issued, click } = harness([CATAPULT], ALL_UNDER);
    expect(click(rightClick)).toBe(true);
    expect(issued).toEqual([
      { kind: 'attackWithVehicle', vehicle: CATAPULT, target: { kind: 'entity', entity: ENEMY_SOLDIER } },
    ]);
  });

  it('loads a land vehicle into an own moored ship ahead of striking, and never into one at sea', () => {
    const { issued, click, flashed } = harness([CATAPULT], {
      ...ALL_UNDER,
      enemies: [under(ENEMY_CART, 'vehicle')],
    });
    expect(click(rightClick)).toBe(true);
    expect(issued).toEqual([{ kind: 'loadIntoVehicle', vehicle: CATAPULT, carrier: SHIP }]);
    expect(flashed).toEqual([[SHIP, 'order']]);

    const atSea = harness([CATAPULT], {
      enemies: [under(ENEMY_CART, 'vehicle')],
      vehicles: [under(SHIP_AT_SEA, 'vehicle')],
    });
    expect(atSea.click(rightClick)).toBe(true);
    expect(atSea.issued).toEqual([
      { kind: 'attackWithVehicle', vehicle: CATAPULT, target: { kind: 'entity', entity: ENEMY_CART } },
    ]);
    expect(atSea.flashed).toEqual([[ENEMY_CART, 'attack']]);
  });

  it('drives an unarmed cart to the spot even over an enemy, since its attack order would be dropped', () => {
    const { issued, click } = harness([HANDCART], { enemies: ENEMIES_UNDER });
    expect(click(rightClick)).toBe(true);
    const spot = worldToTile(CLICK.x, CLICK.y);
    expect(issued).toEqual([{ kind: 'moveVehicle', vehicle: HANDCART, x: spot.col, y: spot.row }]);
  });

  it('moors a ship on a shore its mooring rule accepts and drives it anywhere else', async () => {
    const spot = worldToTile(CLICK.x, CLICK.y);
    const shore = harness([SHIP], { canMoorAt: (_vehicle, x, y) => x === spot.col && y === spot.row });
    expect(shore.click(rightClick)).toBe(true);
    // The order waits on the mooring rule's answer, asked as the click lands.
    expect(shore.issued).toEqual([]);
    await landed();
    expect(shore.issued).toEqual([
      { kind: 'dockVehicle', vehicle: SHIP, x: spot.col, y: spot.row, dock: expect.any(Object) },
    ]);
    const sea = harness([SHIP], { canMoorAt: () => false });
    expect(sea.click(rightClick)).toBe(true);
    await landed();
    expect(sea.issued).toEqual([{ kind: 'moveVehicle', vehicle: SHIP, x: spot.col, y: spot.row }]);
    // A land vehicle never docks, whatever the rule says of the spot.
    const cart = harness([HANDCART], { canMoorAt: () => true });
    expect(cart.click(rightClick)).toBe(true);
    expect(cart.issued).toEqual([{ kind: 'moveVehicle', vehicle: HANDCART, x: spot.col, y: spot.row }]);
  });

  it('docks a group of ships along the shore under the click, each at its own berth apart', async () => {
    const spot = worldToTile(CLICK.x, CLICK.y);
    const fleet = harness([SHIP, SHIP_AT_SEA], { canMoorAt: (_vehicle, _x, y) => y === spot.row });
    expect(fleet.click(rightClick)).toBe(true);
    await landed();
    const docks = fleet.issued.flatMap((command) =>
      command.kind === 'dockVehicle' && command.dock !== undefined ? [command] : [],
    );
    expect(docks.map((command) => command.vehicle).sort()).toEqual([SHIP, SHIP_AT_SEA]);
    expect(fleet.issued).toHaveLength(docks.length);
    const [a, b] = docks.map((command) => command.dock ?? { x: Number.NaN, y: Number.NaN });
    // Two footprint discs of logicsize 2 and the berth gap between them.
    expect(hexDistanceBetween(a?.x ?? 0, a?.y ?? 0, b?.x ?? 0, b?.y ?? 0)).toBeGreaterThan(2 * 2 + 4);
  });

  it('lands each crew behind its dock on a Ctrl or Cmd right-click of a fleet', async () => {
    const spot = worldToTile(CLICK.x, CLICK.y);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const fleet = harness([SHIP, SHIP_AT_SEA], { canMoorAt: (_vehicle, _x, y) => y === spot.row });
      expect(fleet.click({ ...rightClick, ...modifier } as MouseEvent)).toBe(true);
      await landed();
      const unloads = fleet.issued.filter((command) => command.kind === 'unloadPeople');
      expect(unloads.map((command) => command.vehicle).sort()).toEqual([SHIP, SHIP_AT_SEA]);
      for (const unload of unloads) {
        const dock = fleet.issued.find((c) => c.kind === 'dockVehicle' && c.vehicle === unload.vehicle);
        if (dock?.kind !== 'dockVehicle') throw new Error('no dock before the unload');
        expect(unload).toMatchObject({ queued: true, mooring: { x: dock.x, y: dock.y } });
      }
    }
  });

  it('queues a Shift attack, load or drive behind the current order, alone or in a group', () => {
    const queuedClick = { ...rightClick, shiftKey: true } as MouseEvent;
    const spot = worldToTile(CLICK.x, CLICK.y);
    const single = harness([CATAPULT], ALL_UNDER);
    expect(single.click(queuedClick)).toBe(true);
    expect(single.issued).toEqual([
      {
        kind: 'attackWithVehicle',
        vehicle: CATAPULT,
        target: { kind: 'entity', entity: ENEMY_SOLDIER },
        queued: true,
      },
    ]);
    const boarding = harness([HANDCART], ALL_UNDER);
    expect(boarding.click(queuedClick)).toBe(true);
    expect(boarding.issued).toEqual([
      { kind: 'loadIntoVehicle', vehicle: HANDCART, carrier: SHIP, queued: true },
    ]);
    const group = harness([CATAPULT, HANDCART], { enemies: ENEMIES_UNDER });
    expect(group.click(queuedClick)).toBe(true);
    expect(group.issued).toMatchObject([
      { kind: 'attackWithVehicle', vehicle: CATAPULT, queued: true },
      { kind: 'moveVehicle', vehicle: HANDCART, x: spot.col, y: spot.row, queued: true },
    ]);
  });

  /** A ship controller whose first mooring answer is held back until `release`, the rest answering at once. */
  function heldShip() {
    const late: ((rule: MooringRule) => void)[] = [];
    let asked = 0;
    const issued: Command[] = [];
    const pending = createPendingGroundOrders();
    const deps = {
      answered: createAnsweredOrders(),
      selected: () => new Set([SHIP]),
      targets: targetsOf({}),
      snapshot: () => WORLD,
      content: sandboxContent(),
      mapSize: MAP_SIZE,
      viewer: fixedViewerSeat(HUMAN_PLAYER),
      toWorld: (x, y) => ({ x, y }),
      enqueue: (command) => pending.submit(command, (sent) => issued.push(sent)),
      pendingGroundOrders: pending,
      askMooring: (vehicle) =>
        asked++ === 0
          ? new Promise<MooringRule>((resolve) => late.push(resolve))
          : Promise.resolve(shoreRule(vehicle, () => false)),
    } satisfies VehicleOrderDeps;
    const controller = createVehicleOrderController(deps);
    const spot = worldToTile(CLICK.x, CLICK.y);
    return {
      controller,
      click: (event: MouseEvent): boolean => rightClickVehicles(controller, deps, event),
      issued,
      release: (moors: boolean) =>
        late[0]?.(shoreRule(SHIP, (_vehicle, x, y) => moors && x === spot.col && y === spot.row)),
    };
  }

  it('keeps a Shift chain of ship orders in click order whichever answer lands first', async () => {
    const spot = worldToTile(CLICK.x, CLICK.y);
    const { controller, click, issued, release } = heldShip();
    const queuedClick = { ...rightClick, shiftKey: true } as MouseEvent;
    click(queuedClick);
    click(queuedClick);
    // The Goto pick's press needs no answer, and still waits for the clicks before it.
    controller.issueMoveTo(SHIP, { col: 3, row: 3 }, true);
    await landed();
    expect(issued).toEqual([]);
    release(true);
    await landed();
    expect(issued).toEqual([
      {
        kind: 'dockVehicle',
        vehicle: SHIP,
        x: spot.col,
        y: spot.row,
        dock: expect.any(Object),
        queued: true,
      },
      { kind: 'moveVehicle', vehicle: SHIP, x: spot.col, y: spot.row, queued: true },
      { kind: 'moveVehicle', vehicle: SHIP, x: 3, y: 3, queued: true },
    ]);
  });

  it('a plain order given before a ship click is answered calls that click off', async () => {
    const { controller, click, issued, release } = heldShip();
    click({ ...rightClick, shiftKey: true } as MouseEvent);
    controller.issueMoveTo(SHIP, { col: 3, row: 3 });
    release(true);
    await landed();
    expect(issued).toEqual([{ kind: 'moveVehicle', vehicle: SHIP, x: 3, y: 3 }]);
  });

  it('takes no click for a selected enemy vehicle, nor for a group over an own settler, which selects it', () => {
    expect(harness([ENEMY_CART], ALL_UNDER).click(rightClick)).toBe(false);
    const overSettler = harness([CATAPULT, HANDCART], { settlersUnder: [under(OWN_SETTLER, 'settler')] });
    expect(overSettler.click(rightClick)).toBe(false);
    expect(overSettler.issued).toEqual([]);
  });

  it("sends a group's armed vehicles at the enemy under the cursor and drives the rest there", () => {
    const { issued, click } = harness([HANDCART, CATAPULT], {
      enemies: [under(ENEMY_HOUSE, 'building')],
    });
    expect(click(rightClick)).toBe(true);
    const spot = worldToTile(CLICK.x, CLICK.y);
    expect(issued).toEqual([
      { kind: 'attackWithVehicle', vehicle: CATAPULT, target: { kind: 'entity', entity: ENEMY_HOUSE } },
      { kind: 'moveVehicle', vehicle: HANDCART, x: spot.col, y: spot.row },
    ]);
  });

  it('drives a group, settlers beside it or not, to distinct slots around the spot on a plain move', () => {
    const { issued, click } = harness([CATAPULT, HANDCART, OWN_SETTLER], {});
    expect(click(rightClick)).toBe(true);
    const spot = worldToTile(CLICK.x, CLICK.y);
    expect(issued).toHaveLength(1);
    const group = issued[0];
    if (group?.kind !== 'moveVehicleGroup') throw new Error('expected group drive');
    expect(group.members[0]).toEqual({ entity: CATAPULT, x: spot.col, y: spot.row });
    const goals = group.members.map((member) => `${member.x},${member.y}`);
    expect(new Set(goals).size).toBe(2);
  });

  it('drives the selection to a spot named off the world view: a ship docks, a group keeps its slots', async () => {
    const shore = { col: 4, row: 6 };
    const ship = harness([SHIP], { canMoorAt: (_vehicle, x, y) => x === shore.col && y === shore.row });
    expect(ship.controller.issueDriveTo(shore, true)).toBe(true);
    await landed();
    expect(ship.issued).toEqual([
      {
        kind: 'dockVehicle',
        vehicle: SHIP,
        x: shore.col,
        y: shore.row,
        dock: expect.any(Object),
        queued: true,
      },
    ]);
    const group = harness([CATAPULT, HANDCART], {});
    expect(group.controller.issueDriveTo(shore)).toBe(true);
    expect(group.issued.map((command) => command.kind)).toEqual(['moveVehicleGroup']);
    expect(harness([OWN_SETTLER], {}).controller.issueDriveTo(shore)).toBe(false);
  });

  it('leaves a moored captain’s click to the settler orders while direct ship selection still sails', () => {
    expect(harness([SHIP_COMMANDER], {}).click(rightClick)).toBe(false);
    expect(harness([SHIP], {}).click(rightClick)).toBe(true);
    expect(selectedVehicle(VIEW, new Set([SEA_COMMANDER]))).toBe(SHIP_AT_SEA);
    const carried = harness([CARRIED_CART], {});
    expect(carried.click(rightClick)).toBe(true);
    expect(carried.issued[0]).toMatchObject({ kind: 'moveVehicle', vehicle: CARRIED_CART });
  });

  it('drives the vehicle for its commander selected aboard it, and nothing for a passenger aboard', () => {
    const { issued, click } = harness([CART_COMMANDER], { enemies: ENEMIES_UNDER });
    expect(click(rightClick)).toBe(true);
    const spot = worldToTile(CLICK.x, CLICK.y);
    expect(issued).toEqual([{ kind: 'moveVehicle', vehicle: HANDCART, x: spot.col, y: spot.row }]);
    // The commander and its own vehicle selected together are one vehicle, not two.
    expect(selectedVehicle(VIEW, new Set([CART_COMMANDER, HANDCART]))).toBe(HANDCART);
    expect(harness([CART_PASSENGER], ALL_UNDER).click(rightClick)).toBe(false);
    // A cart riding a ship has nothing to drive; its commander's click orders nothing, as the sim's rule.
    expect(harness([CARRIED_COMMANDER], ALL_UNDER).click(rightClick)).toBe(false);
  });
});

describe('right-click attach', () => {
  it('assigns each selected settler the attach rule admits to the own vehicle under the cursor', async () => {
    const second = OWN_SETTLER + 1;
    const h = harness([OWN_SETTLER, second], {
      vehicles: [under(SHIP, 'vehicle')],
      settlers: [OWN_SETTLER, second],
      canAttachToVehicle: (settler) => settler === OWN_SETTLER,
    });
    expect(h.attach(rightClick, () => undefined)).toBe(true);
    await landed();
    expect(h.issued).toEqual([{ kind: 'attachToVehicle', entity: OWN_SETTLER, vehicle: SHIP }]);
    expect(h.flashed).toEqual([[SHIP, 'order']]);
  });

  /** An attach controller on the shared seam whose rule answers, `admits`, are held back until `release`. */
  function heldAttach(selected: readonly number[] = [OWN_SETTLER], admits = (_settler: number) => true) {
    const late: (() => void)[] = [];
    const issued: Command[] = [];
    const pending = createPendingGroundOrders();
    const enqueue = (command: PlayerCommand): void => pending.submit(command, (sent) => issued.push(sent));
    const deps = {
      answered: createAnsweredOrders(),
      selected: () => new Set(selected),
      targets: targetsOf({ vehicles: [under(SHIP, 'vehicle')], settlers: [...selected] }),
      snapshot: () => WORLD,
      content: sandboxContent(),
      mapSize: MAP_SIZE,
      viewer: fixedViewerSeat(HUMAN_PLAYER),
      toWorld: (x, y) => ({ x, y }),
      enqueue,
      pendingGroundOrders: pending,
      askAttachToVehicle: (settler) =>
        new Promise<boolean>((resolve) => late.push(() => resolve(admits(settler)))),
    } satisfies VehicleOrderDeps;
    const controller = createVehicleOrderController(deps);
    const attach = (event: MouseEvent, onNoneBoards: () => void): boolean =>
      rightClickAttach(controller, deps, event, onNoneBoards);
    const release = (): void => {
      for (const answer of late) answer();
    };
    return { attach, issued, enqueue, release };
  }

  it('queues a Shift boarding ahead of a later Shift click, whichever lands first', async () => {
    const { attach, issued, enqueue, release } = heldAttach();
    expect(attach({ ...rightClick, shiftKey: true } as MouseEvent, () => {})).toBe(true);
    // The settlers' next Shift click, sent at once, still waits for the boarding asked before it.
    enqueue({ kind: 'moveUnit', entity: OWN_SETTLER as Entity, x: 3, y: 3, queued: true });
    expect(issued).toEqual([]);
    release();
    await landed();
    expect(issued).toEqual([
      { kind: 'attachToVehicle', entity: OWN_SETTLER, vehicle: SHIP, queued: true },
      { kind: 'moveUnit', entity: OWN_SETTLER, x: 3, y: 3, queued: true },
    ]);
  });

  it('a plain order given before a boarding is answered calls it off without handing the click on', async () => {
    const refused = OWN_SETTLER + 1;
    const { attach, issued, enqueue, release } = heldAttach([OWN_SETTLER, refused], (s) => s !== refused);
    let handedOn = 0;
    attach(rightClick, () => handedOn++);
    enqueue({ kind: 'moveUnit', entity: OWN_SETTLER as Entity, x: 3, y: 3 });
    release();
    await landed();
    expect(issued).toEqual([{ kind: 'moveUnit', entity: OWN_SETTLER, x: 3, y: 3 }]);
    expect(handedOn).toBe(0);
  });

  it('yields to an own settler or an enemy drawn over the vehicle, the crew waiting at its door', () => {
    const rider = harness([OWN_SETTLER], {
      vehicles: [under(SHIP, 'vehicle')],
      settlersUnder: [under(CART_COMMANDER, 'settler')],
      settlers: [OWN_SETTLER],
    });
    expect(rider.attach(rightClick, () => undefined)).toBe(false);
    const enemy = harness([OWN_SETTLER], {
      vehicles: [under(SHIP, 'vehicle')],
      enemies: [under(ENEMY_SOLDIER, 'settler')],
      settlers: [OWN_SETTLER],
    });
    expect(enemy.attach(rightClick, () => undefined)).toBe(false);
    expect([...rider.issued, ...enemy.issued]).toEqual([]);
  });

  it('orders nothing when no vehicle lies under the cursor, and hands the click on when nobody may board', async () => {
    const none = harness([OWN_SETTLER], { settlers: [OWN_SETTLER] });
    expect(none.attach(rightClick, () => undefined)).toBe(false);
    const refused = harness([OWN_SETTLER], {
      vehicles: [under(SHIP_AT_SEA, 'vehicle')],
      settlers: [OWN_SETTLER],
      canAttachToVehicle: () => false,
    });
    let handedOn = 0;
    expect(refused.attach(rightClick, () => handedOn++)).toBe(true);
    await landed();
    expect(refused.issued).toEqual([]);
    expect(refused.flashed).toEqual([]);
    expect(handedOn).toBe(1);
  });
});

describe('vehicle picks', () => {
  it('keeps a Shift-pressed drive pick armed for the next waypoint, each press queued', () => {
    const { issued, pickMode } = harness([HANDCART], {});
    pickMode.arm({ kind: 'vehicle-destination', vehicle: HANDCART });
    const shiftClick = { ...leftClick, shiftKey: true } as MouseEvent;
    expect(pickMode.handleMouseDown(shiftClick)).toBe('ordered');
    expect(pickMode.handleMouseDown(shiftClick)).toBe('ordered');
    expect(pickMode.handleMouseDown(leftClick)).toBe('ordered');
    expect(pickMode.isArmed()).toBe(false);
    expect(issued).toEqual([
      { kind: 'moveVehicle', vehicle: HANDCART, x: 3, y: 3, queued: true },
      { kind: 'moveVehicle', vehicle: HANDCART, x: 3, y: 3, queued: true },
      { kind: 'moveVehicle', vehicle: HANDCART, x: 3, y: 3 },
    ]);
  });

  it('keeps each window pick armed through Shift presses, each order queued', () => {
    const { issued, pickMode } = harness([SHIP], ALL_UNDER);
    const shiftClick = { ...leftClick, shiftKey: true } as MouseEvent;
    const picks = [
      { kind: 'vehicle-dock', vehicles: [SHIP] },
      { kind: 'vehicle-attack-building', vehicle: CATAPULT },
      { kind: 'vehicle-attack-position', vehicle: CATAPULT },
      { kind: 'vehicle-carrier', vehicle: HANDCART },
    ] as const;
    for (const pick of picks) {
      pickMode.arm(pick);
      expect(pickMode.handleMouseDown(shiftClick)).toBe('ordered');
      expect(pickMode.isArmed()).toBe(true);
    }
    expect(issued).toEqual([
      { kind: 'dockVehicle', vehicle: SHIP, x: 3, y: 3, queued: true },
      {
        kind: 'attackWithVehicle',
        vehicle: CATAPULT,
        target: { kind: 'entity', entity: ENEMY_HOUSE },
        queued: true,
      },
      {
        kind: 'attackWithVehicle',
        vehicle: CATAPULT,
        target: { kind: 'ground', hx: 3, hy: 3 },
        queued: true,
      },
      { kind: 'loadIntoVehicle', vehicle: HANDCART, carrier: SHIP, queued: true },
    ]);
  });

  it('marches the selected own siege vehicles of an attack-move to the spot, and no cart or foreign vehicle', () => {
    const { issued, controller, pickMode } = harness([CATAPULT, HANDCART, ENEMY_CART], {});
    const vehicles = controller.selectedSiegeVehicles();
    expect(vehicles).toEqual([CATAPULT]);
    pickMode.arm({ kind: 'attack-move', units: [], vehicles });
    expect(pickMode.handleMouseDown(leftClick)).toBe('ordered');
    expect(issued).toEqual([{ kind: 'moveVehicle', vehicle: CATAPULT, x: 3, y: 3, attackMove: true }]);
  });

  it('refuses oversized vehicle formations without any order or marker', () => {
    const h = harness([], {});
    expect(
      h.controller.issueAttackMove(
        Array.from({ length: MAX_UNIT_ORDER_MEMBERS + 1 }, (_, i) => i + 1),
        { col: 10, row: 10 },
      ),
    ).toBe(false);
    expect(h.issued).toEqual([]);
    expect(h.marked).toEqual([]);
  });

  it('groups the admitted boarding candidates and refuses an oversized candidate gesture', async () => {
    const settlers = Array.from({ length: BOARDING_GROUP }, (_, i) => i + FIRST_CANDIDATE);
    const h = harness(settlers, {
      settlers,
      vehicles: [under(SHIP, 'vehicle')],
      canAttachToVehicle: () => true,
    });
    expect(h.attach(rightClick, () => {})).toBe(true);
    await landed();
    expect(h.issued).toEqual([
      {
        kind: 'unitActionGroup',
        members: settlers.map((entity) => ({ entity })),
        action: { kind: 'attachToVehicle', vehicle: SHIP },
      },
    ]);
    const oversized = Array.from({ length: MAX_UNIT_ORDER_MEMBERS + 1 }, (_, i) => i + FIRST_CANDIDATE);
    const rejected = harness(oversized, { settlers: oversized, vehicles: [under(SHIP, 'vehicle')] });
    expect(rejected.attach(rightClick, () => {})).toBe(false);
    expect(rejected.issued).toEqual([]);
  });

  it('spreads a marched group over distinct goals around the spot', () => {
    const { issued, controller, marked } = harness([], {});
    expect(controller.issueAttackMove([CATAPULT, SECOND_CATAPULT], { col: 10, row: 10 })).toBe(true);
    // One red marker on the spot the group was sent to, not one per goal.
    expect(marked).toEqual([[{ col: 10, row: 10 }, 'attack']]);
    expect(issued).toHaveLength(1);
    const group = issued[0];
    if (group?.kind !== 'moveVehicleGroup') throw new Error('expected group march');
    expect(group.attackMove).toBe(true);
    const goals = group.members.map((member) => `${member.x},${member.y}`);
    expect(goals[0]).toBe('10,10');
    expect(new Set(goals).size).toBe(2);
  });

  it('lands the crew behind the dock on a Ctrl or Cmd press of the dock pick', () => {
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const { issued, pickMode } = harness([SHIP], ALL_UNDER);
      pickMode.arm({ kind: 'vehicle-dock', vehicles: [SHIP] });
      expect(pickMode.handleMouseDown({ ...leftClick, ...modifier } as MouseEvent)).toBe('ordered');
      expect(issued).toEqual([
        { kind: 'dockVehicle', vehicle: SHIP, x: 3, y: 3 },
        { kind: 'unloadPeople', vehicle: SHIP, queued: true, mooring: { x: 3, y: 3 } },
      ]);
    }
    // The same press on the map overview.
    const overview = harness([SHIP], ALL_UNDER);
    overview.pickMode.arm({ kind: 'vehicle-dock', vehicles: [SHIP] });
    expect(overview.pickMode.handleOverviewPress(0, { col: 3, row: 3 }, false, true)).toBe('ordered');
    expect(overview.issued.map((command) => command.kind)).toEqual(['dockVehicle', 'unloadPeople']);
  });

  it('names the ship of an armed dock pick, and drops a dock click on a spot the mooring rule rejects', async () => {
    const { issued, pickMode, marked } = harness([SHIP], { canMoorAt: () => false });
    expect(pickMode.dockVehicle()).toBeNull();
    pickMode.arm({ kind: 'vehicle-dock', vehicles: [SHIP] });
    expect(pickMode.dockVehicle()).toBe(SHIP);
    pickMode.handleMouseDown(leftClick);
    expect(pickMode.dockVehicle()).toBeNull();
    await landed();
    expect(issued).toEqual([]);
    expect(marked).toEqual([]);
  });

  it('lights the own vehicles of an armed assign-vehicle pick by the attach rule and drops a red click', async () => {
    const { issued, pickMode } = harness([OWN_SETTLER], {
      vehicles: [under(HANDCART, 'vehicle')],
      canAttachToVehicle: (_settler, vehicle) => vehicle === SHIP,
    });
    expect(pickMode.highlight()).toBeNull();
    pickMode.arm({ kind: 'vehicle', settler: OWN_SETTLER });
    expect(pickMode.highlight()).toEqual([
      { id: CATAPULT, tone: 'refused' },
      { id: HANDCART, tone: 'refused' },
      { id: SHIP, tone: 'candidate' },
      { id: SHIP_AT_SEA, tone: 'refused' },
      { id: CARRIED_CART, tone: 'refused' },
    ]);
    pickMode.handleMouseDown(leftClick);
    await landed();
    expect(issued).toEqual([]);
    expect(pickMode.highlight()).toBeNull();
  });

  it("arms the ring's assign-vehicle pick, which attaches the settler to the own vehicle it clicks", async () => {
    const { issued, pickMode } = harness([OWN_SETTLER], { vehicles: [under(HANDCART, 'vehicle')] });
    issueRingCommand('assignVehicle', [OWN_SETTLER], {
      enqueue: () => undefined,
      pickMode,
      openEquipment: () => undefined,
      toggleWorkArea: () => undefined,
      siegeVehicles: () => [],
    });
    expect(pickMode.isArmed()).toBe(true);
    expect(pickMode.handleMouseDown(leftClick)).toBe('ordered');
    await landed();
    expect(issued).toEqual([{ kind: 'attachToVehicle', entity: OWN_SETTLER, vehicle: HANDCART }]);
    // A miss on empty ground orders nothing and drops the mode.
    pickMode.arm({ kind: 'vehicle', settler: OWN_SETTLER });
    expect(pickMode.handleMouseDown({ ...leftClick, clientX: CLICK.x + 500 } as MouseEvent)).toBe('missed');
    expect(issued.length).toBe(1);
  });

  it('pins a ship the sim admits with one flash, and hands a refused pin on with no order', async () => {
    const pinning = async (admits: boolean) => {
      const h = harness([OWN_SETTLER], { canPinTradeShip: () => admits });
      const outcomes = pinOutcomes(h.controller, false);
      expect(outcomes).toEqual([]);
      await landed();
      return { issued: h.issued, flashed: h.flashed, outcomes };
    };
    expect(await pinning(true)).toEqual({
      issued: [{ kind: 'setTradeShip', entity: OWN_SETTLER, ship: SHIP }],
      flashed: [[SHIP, 'assign']],
      outcomes: ['set'],
    });
    expect(await pinning(false)).toEqual({ issued: [], flashed: [], outcomes: ['refused'] });
  });

  it('calls a refused pin off once a newer order took the trader', async () => {
    const pendingGroundOrders = createPendingGroundOrders();
    const h = harness([OWN_SETTLER], { canPinTradeShip: () => false, pendingGroundOrders });
    const outcomes = pinOutcomes(h.controller, false);
    pendingGroundOrders.begin([OWN_SETTLER], false);
    await landed();
    expect(outcomes).toEqual([]);
  });

  it('lets a pinned ship go at once, without asking', () => {
    const h = harness([OWN_SETTLER], { canPinTradeShip: () => false });
    expect(pinOutcomes(h.controller, true)).toEqual(['set']);
    expect(h.issued).toEqual([{ kind: 'setTradeShip', entity: OWN_SETTLER, ship: null }]);
  });

  it("seats the own settler a vehicle panel's pick clicks, and drives an own cart onto a ship's deck", async () => {
    const seat = harness([SHIP], {
      settlersUnder: [under(OWN_SETTLER, 'settler')],
      canAttachToVehicle: (_settler, vehicle) => vehicle === SHIP,
    });
    seat.pickMode.arm({ kind: 'vehicle-rider', vehicle: SHIP });
    expect(seat.pickMode.armed()).toEqual({ kind: 'vehicle-rider', vehicle: SHIP });
    expect(seat.pickMode.handleMouseDown(leftClick)).toBe('ordered');
    expect(seat.pickMode.armed()).toBeNull();
    // The attach rule, asked as the click lands, refuses this one: the click orders nothing.
    seat.pickMode.arm({ kind: 'vehicle-rider', vehicle: SHIP_AT_SEA });
    expect(seat.pickMode.handleMouseDown(leftClick)).toBe('ordered');
    await landed();
    expect(seat.issued).toEqual([{ kind: 'attachToVehicle', entity: OWN_SETTLER, vehicle: SHIP }]);

    const deck = harness([SHIP], { vehicles: [under(SHIP, 'vehicle'), under(HANDCART, 'vehicle')] });
    deck.pickMode.arm({ kind: 'vehicle-deck', vehicle: SHIP });
    expect(deck.pickMode.handleMouseDown(leftClick)).toBe('ordered');
    // A ship at sea takes nothing aboard.
    deck.pickMode.arm({ kind: 'vehicle-deck', vehicle: SHIP_AT_SEA });
    expect(deck.pickMode.handleMouseDown(leftClick)).toBe('missed');
    expect(deck.issued).toEqual([{ kind: 'loadIntoVehicle', vehicle: HANDCART, carrier: SHIP }]);
  });
});
