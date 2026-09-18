import { type Command, fx, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import { fixedViewerSeat } from '../src/game/viewer-seat.js';
import {
  sandboxContent,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_SHIP_SMALL,
} from '../src/game/sandbox/index.js';
import { type Pickable, worldToTile } from '../src/view/picking.js';
import { createPickModeController } from '../src/view/unit-controls/pick-mode.js';
import { issueRingCommand } from '../src/view/unit-controls/ring-commands.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';
import { createVehicleOrderController } from '../src/view/unit-controls/vehicle-orders.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * The right-click defaults of a selected vehicle and the picks the vehicle window arms. Every target sits
 * under one pixel, so only the order of the defaults decides what the click does.
 */

const CATAPULT = 10;
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
const ENEMY_PLAYER = 1;

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
): Ent => ({
  id,
  components: {
    Vehicle: { vehicleType, tribe: 1, moored, passengers, vehicles: [], carrier },
    Owner: { player },
    ...(carrier === null ? { Position: at(2, 2) } : {}), // a carried vehicle stands nowhere on the map
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
  vehicle(SHIP, VEHICLE_SHIP_SMALL, HUMAN_PLAYER, true),
  vehicle(SHIP_AT_SEA, VEHICLE_SHIP_SMALL, HUMAN_PLAYER, false),
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

const under = (ref: number, kind: NonNullable<Pickable['kind']>): Pickable => ({ ref, ...CLICK, kind });

interface Arms {
  readonly enemies?: readonly Pickable[];
  readonly vehicles?: readonly Pickable[];
  /** The sim's vehicle rules, absent by default: every spot moors and every own vehicle takes a rider. */
  readonly canMoorAt?: (vehicle: number, x: number, y: number) => boolean;
  readonly canAttachToVehicle?: (settler: number, vehicle: number) => boolean;
  /** The selected settlers standing on the map, for the right-click attach. */
  readonly settlers?: readonly number[];
  /** Own settlers drawn under the cursor, which take the right-click ahead of a vehicle beneath them. */
  readonly settlersUnder?: readonly Pickable[];
}

const targetsOf = (arms: Arms): UnitTargets => ({
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
  ownedSettlersIn: () => (arms.settlers ?? []).map((ref) => ({ ref, x: 0, y: 0 })),
});

function harness(selected: readonly number[], arms: Arms) {
  const issued: Command[] = [];
  const targets = targetsOf(arms);
  const controller = createVehicleOrderController({
    selected: () => new Set(selected),
    targets,
    snapshot: () => WORLD,
    content: sandboxContent(),
    mapSize: MAP_SIZE,
    viewer: fixedViewerSeat(HUMAN_PLAYER),
    toWorld: (x, y) => ({ x, y }),
    enqueue: (command) => issued.push(command),
    canMoorAt: arms.canMoorAt,
    canAttachToVehicle: arms.canAttachToVehicle,
  });
  const pickMode = createPickModeController({
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
  return { issued, controller, pickMode };
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
    const { issued, controller } = harness([CATAPULT], ALL_UNDER);
    expect(controller.issueRightClick(rightClick)).toBe(true);
    expect(issued).toEqual([
      { kind: 'attackWithVehicle', vehicle: CATAPULT, target: { kind: 'entity', entity: ENEMY_SOLDIER } },
    ]);
  });

  it('loads a land vehicle into an own moored ship ahead of striking, and never into one at sea', () => {
    const { issued, controller } = harness([CATAPULT], {
      ...ALL_UNDER,
      enemies: [under(ENEMY_CART, 'vehicle')],
    });
    expect(controller.issueRightClick(rightClick)).toBe(true);
    expect(issued).toEqual([{ kind: 'loadIntoVehicle', vehicle: CATAPULT, carrier: SHIP }]);

    const atSea = harness([CATAPULT], {
      enemies: [under(ENEMY_CART, 'vehicle')],
      vehicles: [under(SHIP_AT_SEA, 'vehicle')],
    });
    expect(atSea.controller.issueRightClick(rightClick)).toBe(true);
    expect(atSea.issued).toEqual([
      { kind: 'attackWithVehicle', vehicle: CATAPULT, target: { kind: 'entity', entity: ENEMY_CART } },
    ]);
  });

  it('drives an unarmed cart to the spot even over an enemy, since its attack order would be dropped', () => {
    const { issued, controller } = harness([HANDCART], { enemies: ENEMIES_UNDER });
    expect(controller.issueRightClick(rightClick)).toBe(true);
    const spot = worldToTile(CLICK.x, CLICK.y);
    expect(issued).toEqual([{ kind: 'moveVehicle', vehicle: HANDCART, x: spot.col, y: spot.row }]);
  });

  it('moors a ship on a shore its mooring rule accepts and drives it anywhere else', () => {
    const spot = worldToTile(CLICK.x, CLICK.y);
    const shore = harness([SHIP], { canMoorAt: (_vehicle, x, y) => x === spot.col && y === spot.row });
    expect(shore.controller.issueRightClick(rightClick)).toBe(true);
    expect(shore.issued).toEqual([{ kind: 'dockVehicle', vehicle: SHIP, x: spot.col, y: spot.row }]);
    const sea = harness([SHIP], { canMoorAt: () => false });
    expect(sea.controller.issueRightClick(rightClick)).toBe(true);
    expect(sea.issued).toEqual([{ kind: 'moveVehicle', vehicle: SHIP, x: spot.col, y: spot.row }]);
    // A land vehicle never docks, whatever the rule says of the spot.
    const cart = harness([HANDCART], { canMoorAt: () => true });
    expect(cart.controller.issueRightClick(rightClick)).toBe(true);
    expect(cart.issued).toEqual([{ kind: 'moveVehicle', vehicle: HANDCART, x: spot.col, y: spot.row }]);
  });

  it('takes no click while a settler shares the selection, an enemy vehicle is selected, or two are', () => {
    expect(harness([CATAPULT, OWN_SETTLER], ALL_UNDER).controller.issueRightClick(rightClick)).toBe(false);
    expect(harness([ENEMY_CART], ALL_UNDER).controller.issueRightClick(rightClick)).toBe(false);
    expect(harness([CATAPULT, HANDCART], ALL_UNDER).controller.issueRightClick(rightClick)).toBe(false);
  });

  it('drives the vehicle for its commander selected aboard it, and nothing for a passenger aboard', () => {
    const { issued, controller } = harness([CART_COMMANDER], { enemies: ENEMIES_UNDER });
    expect(controller.issueRightClick(rightClick)).toBe(true);
    const spot = worldToTile(CLICK.x, CLICK.y);
    expect(issued).toEqual([{ kind: 'moveVehicle', vehicle: HANDCART, x: spot.col, y: spot.row }]);
    // The commander and its own vehicle selected together are one vehicle, not two.
    expect(harness([CART_COMMANDER, HANDCART], ALL_UNDER).controller.selectedVehicle()).toBe(HANDCART);
    expect(harness([CART_PASSENGER], ALL_UNDER).controller.issueRightClick(rightClick)).toBe(false);
    // A cart riding a ship has nothing to drive; its commander's click orders nothing, as the sim's rule.
    expect(harness([CARRIED_COMMANDER], ALL_UNDER).controller.issueRightClick(rightClick)).toBe(false);
  });
});

describe('right-click attach', () => {
  it('assigns each selected settler the attach rule admits to the own vehicle under the cursor', () => {
    const second = OWN_SETTLER + 1;
    const h = harness([OWN_SETTLER, second], {
      vehicles: [under(SHIP, 'vehicle')],
      settlers: [OWN_SETTLER, second],
      canAttachToVehicle: (settler) => settler === OWN_SETTLER,
    });
    expect(h.controller.issueAttachSelected(rightClick)).toBe(true);
    expect(h.issued).toEqual([{ kind: 'attachToVehicle', entity: OWN_SETTLER, vehicle: SHIP }]);
  });

  it('yields to an own settler or an enemy drawn over the vehicle, the crew waiting at its door', () => {
    const rider = harness([OWN_SETTLER], {
      vehicles: [under(SHIP, 'vehicle')],
      settlersUnder: [under(CART_COMMANDER, 'settler')],
      settlers: [OWN_SETTLER],
    });
    expect(rider.controller.issueAttachSelected(rightClick)).toBe(false);
    const enemy = harness([OWN_SETTLER], {
      vehicles: [under(SHIP, 'vehicle')],
      enemies: [under(ENEMY_SOLDIER, 'settler')],
      settlers: [OWN_SETTLER],
    });
    expect(enemy.controller.issueAttachSelected(rightClick)).toBe(false);
    expect([...rider.issued, ...enemy.issued]).toEqual([]);
  });

  it('orders nothing when no vehicle lies under the cursor or nobody selected may board', () => {
    const none = harness([OWN_SETTLER], { settlers: [OWN_SETTLER] });
    expect(none.controller.issueAttachSelected(rightClick)).toBe(false);
    const refused = harness([OWN_SETTLER], {
      vehicles: [under(SHIP_AT_SEA, 'vehicle')],
      settlers: [OWN_SETTLER],
      canAttachToVehicle: () => false,
    });
    expect(refused.controller.issueAttachSelected(rightClick)).toBe(false);
    expect(refused.issued).toEqual([]);
  });
});

describe('vehicle picks', () => {
  it('resolves the window picks against the spot or the drawn target', () => {
    const { issued, pickMode } = harness([SHIP], ALL_UNDER);
    pickMode.arm({ kind: 'vehicle-dock', vehicle: SHIP });
    expect(pickMode.handleMouseDown(leftClick)).toBe('ordered');
    pickMode.arm({ kind: 'vehicle-attack-building', vehicle: CATAPULT });
    expect(pickMode.handleMouseDown(leftClick)).toBe('ordered');
    pickMode.arm({ kind: 'vehicle-attack-position', vehicle: CATAPULT });
    expect(pickMode.handleMouseDown(leftClick)).toBe('ordered');
    pickMode.arm({ kind: 'vehicle-carrier', vehicle: HANDCART });
    expect(pickMode.handleMouseDown(leftClick)).toBe('ordered');
    expect(issued).toEqual([
      { kind: 'dockVehicle', vehicle: SHIP, x: 3, y: 3 },
      { kind: 'attackWithVehicle', vehicle: CATAPULT, target: { kind: 'entity', entity: ENEMY_HOUSE } },
      { kind: 'attackWithVehicle', vehicle: CATAPULT, target: { kind: 'ground', hx: 3, hy: 3 } },
      { kind: 'loadIntoVehicle', vehicle: HANDCART, carrier: SHIP },
    ]);
  });

  it('names the ship of an armed dock pick, and drops a dock click on a spot the mooring rule rejects', () => {
    const { issued, pickMode } = harness([SHIP], { canMoorAt: () => false });
    expect(pickMode.dockVehicle()).toBeNull();
    pickMode.arm({ kind: 'vehicle-dock', vehicle: SHIP });
    expect(pickMode.dockVehicle()).toBe(SHIP);
    expect(pickMode.handleMouseDown(leftClick)).toBe('missed');
    expect(pickMode.dockVehicle()).toBeNull();
    expect(issued).toEqual([]);
  });

  it('lights the own vehicles of an armed assign-vehicle pick by the attach rule and drops a red click', () => {
    const { issued, pickMode } = harness([OWN_SETTLER], {
      vehicles: [under(HANDCART, 'vehicle')],
      canAttachToVehicle: (_settler, vehicle) => vehicle === SHIP,
    });
    expect(pickMode.highlight()).toBeNull();
    pickMode.arm({ kind: 'vehicle', settler: OWN_SETTLER });
    expect(pickMode.highlight()).toEqual([
      { id: CATAPULT, ok: false },
      { id: HANDCART, ok: false },
      { id: SHIP, ok: true },
      { id: SHIP_AT_SEA, ok: false },
      { id: CARRIED_CART, ok: false },
    ]);
    expect(pickMode.handleMouseDown(leftClick)).toBe('missed');
    expect(issued).toEqual([]);
    expect(pickMode.highlight()).toBeNull();
  });

  it("arms the ring's assign-vehicle pick, which attaches the settler to the own vehicle it clicks", () => {
    const { issued, pickMode } = harness([OWN_SETTLER], { vehicles: [under(HANDCART, 'vehicle')] });
    issueRingCommand('assignVehicle', [OWN_SETTLER], {
      enqueue: () => undefined,
      pickMode,
      openEquipment: () => undefined,
      toggleWorkArea: () => undefined,
    });
    expect(pickMode.isArmed()).toBe(true);
    expect(pickMode.handleMouseDown(leftClick)).toBe('ordered');
    expect(issued).toEqual([{ kind: 'attachToVehicle', entity: OWN_SETTLER, vehicle: HANDCART }]);
    // A miss on empty ground orders nothing and drops the mode.
    pickMode.arm({ kind: 'vehicle', settler: OWN_SETTLER });
    expect(pickMode.handleMouseDown({ ...leftClick, clientX: CLICK.x + 500 } as MouseEvent)).toBe('missed');
    expect(issued.length).toBe(1);
  });
});
