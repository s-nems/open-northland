import {
  type Entity,
  type PlayerCommand,
  type Simulation,
  systems,
  type VehicleView,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_OXCART,
  VEHICLE_SHIP_SMALL,
} from '../src/game/sandbox/index.js';
import { fixedViewerSeat } from '../src/game/viewer-seat.js';
import { buildUnitPanelModel, type UnitPanelModelContext } from '../src/hud/details-panel/index.js';
import type {
  VehicleCrewModel,
  VehicleHoldModel,
  VehiclePanelModel,
  VehicleRiderModel,
} from '../src/hud/details-panel/model/index.js';
import { vehicleStatus } from '../src/hud/details-panel/model/vehicle.js';
import { createCargoState } from '../src/hud/dom/vehicle-panel/cargo.js';
import { commanderValue, seatWells } from '../src/hud/dom/vehicle-panel/crew.js';
import { cargoFill, cargoFlow, cargoLineTooltip } from '../src/hud/dom/vehicle-panel/hold.js';
import { orderTexts } from '../src/hud/dom/vehicle-panel/portrait.js';
import { messages } from '../src/i18n/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import { vehiclesScene } from '../src/scenes/vehicles.js';
import type { PickMode } from '../src/view/unit-controls/pick-mode.js';
import {
  armedVehiclePick,
  orderPick,
  vehiclePanelActions,
  vehiclePeersOf,
} from '../src/view/unit-controls/vehicle-panel.js';
import { ctxOf } from './support/sandbox.js';

/** The panel context with the sim's trader seam, which the Handel section reads. */
const tradeCtxOf = (sim: Simulation): UnitPanelModelContext => ({
  ...ctxOf(sim),
  traderView: (entity) => sim.traderView(entity as Entity),
});

/** The vehicles scene one tick in: the trader attached to the handcart, the ox cart loaded with wood and
 *  no driver, the catapult mid-attack and the ships moored. */
function vehiclesWorld(): { sim: Simulation; snapshot: WorldSnapshot; ctx: UnitPanelModelContext } {
  const sim = createSceneSim(vehiclesScene);
  sim.step();
  return { sim, snapshot: sim.snapshot(), ctx: tradeCtxOf(sim) };
}

function ownVehicle(sim: Simulation, type: number): VehicleView {
  const view = sim.vehiclesOf(HUMAN_PLAYER).find((v) => v.vehicleType === type);
  if (view === undefined) throw new Error(`no own vehicle of type ${type}`);
  return view;
}

function modelOf(
  world: { snapshot: WorldSnapshot; ctx: UnitPanelModelContext },
  entity: number,
): VehiclePanelModel {
  const model = buildUnitPanelModel(world.snapshot, new Set([entity]), world.ctx);
  if (model.kind !== 'vehicle') throw new Error(`expected a vehicle model, got ${model.kind}`);
  return model;
}

/** A copy of the snapshot with the vehicle component of `vehicle` changed. */
function withVehicle(
  snapshot: WorldSnapshot,
  vehicle: number,
  change: (v: Record<string, unknown>) => void,
): WorldSnapshot {
  const copy = structuredClone(snapshot);
  const v = copy.entities.find((e) => e.id === vehicle)?.components.Vehicle as Record<string, unknown>;
  change(v);
  return copy;
}

const orders = (model: VehiclePanelModel): string[] => [
  ...model.orders.map((row) => row.order),
  ...model.attackOrders.map((row) => row.order),
];

describe('vehicle panel model', () => {
  it("shows a trader's cart with the trader as its driver, the route's Handel and a read-only hold", () => {
    const world = vehiclesWorld();
    const cart = ownVehicle(world.sim, VEHICLE_HANDCART);
    const model = modelOf(world, cart.entity);
    expect(model.vehicleClass).toBe('cart');
    expect(model.title).toBe(messages().goods.handcart);
    expect(model.crew.commander?.entity).toBe(cart.commander);
    expect(model.crew.seats).toEqual([]);
    expect(orders(model)).toEqual(['goTo', 'stop', 'boardShip']);
    expect(model.orders.every((row) => row.control === true)).toBe(true);
    expect(model.trade?.entityId).toBe(cart.commander);
    expect(model.hold?.routed).toBe(true);
    expect(model.health).toEqual({ hitpoints: cart.hitpoints, max: cart.maxHitpoints });
  });

  it('lists what a driverless cart holds and refuses its drive, while the hold takes requests', () => {
    const world = vehiclesWorld();
    const cart = ownVehicle(world.sim, VEHICLE_OXCART);
    const model = modelOf(world, cart.entity);
    expect(model.crew.commander).toBeNull();
    expect(model.crew.assign).toBe(true);
    expect(model.status.tone).toBe('trouble');
    expect(model.status.label).toBe(messages().hud.vehiclePanel.status.noCommander.cart);
    expect(model.orders.find((row) => row.order === 'goTo')?.control).toBe(
      messages().hud.vehiclePanel.refusals.noCommander.cart,
    );
    expect(model.hold?.rows.map((row) => [row.goodType, row.current])).toEqual(
      cart.stock.map((line) => [line.good, line.current]),
    );
    expect(model.hold?.cargoHand).toBe(false);
    expect(model.hold?.routed).toBe(false);
    expect(model.hold?.goods.length).toBeGreaterThan(model.hold?.rows.length ?? 0);
  });

  it('gives a siege engine the attack row and its stance, and no hold', () => {
    const world = vehiclesWorld();
    const model = modelOf(world, ownVehicle(world.sim, VEHICLE_CATAPULT).entity);
    expect(model.vehicleClass).toBe('siege');
    expect(orders(model)).toEqual([
      'goTo',
      'stop',
      'boardShip',
      'attackSettler',
      'attackBuilding',
      'attackVehicle',
      'attackPosition',
    ]);
    expect(model.stance).toBe('hold');
    expect(model.hold).toBeNull();
    expect(model.status.label).toBe(messages().hud.vehiclePanel.status.attacks);
  });

  it('seats a moored ship, lands its crew, and refuses both at sea', () => {
    const world = vehiclesWorld();
    const ship = ownVehicle(world.sim, VEHICLE_SHIP_SMALL);
    const moored = modelOf(world, ship.entity);
    expect(moored.vehicleClass).toBe('ship');
    expect(orders(moored)).toEqual(['goTo', 'stop', 'dock']);
    expect(moored.crew.seats.length).toBe(ship.passengerCapacity - 1);
    expect(moored.crew.count).toBe(ship.passengers.length);
    expect(moored.crew.capacity).toBe(ship.passengerCapacity);
    expect(moored.crew.unload).toBe(true);
    expect(moored.crew.deck?.capacity).toBe(ship.vehicleCapacity);
    expect(moored.status.label).toBe(messages().hud.vehiclePanel.status.moored);

    const atSea = modelOf(
      { ...world, snapshot: withVehicle(world.snapshot, ship.entity, (v) => (v.moored = false)) },
      ship.entity,
    );
    const refusal = messages().hud.vehiclePanel.refusals.atSea;
    expect(atSea.crew.unload).toBe(refusal);
    expect(atSea.crew.assign).toBe(refusal);
    expect(atSea.crew.load).toBe(messages().hud.vehiclePanel.refusals.notMoored);
  });

  it('shows a carried cart riding its ship, leaving only while the ship is moored', () => {
    const world = vehiclesWorld();
    const cart = ownVehicle(world.sim, VEHICLE_HANDCART).entity;
    const ship = ownVehicle(world.sim, VEHICLE_SHIP_SMALL).entity;
    const carried = withVehicle(world.snapshot, cart, (v) => (v.carrier = ship));
    const model = modelOf({ ...world, snapshot: carried }, cart);
    expect(model.status.carrier).toEqual({ id: ship, label: messages().goods.ship_small });
    expect(orders(model)).toEqual(['goTo', 'stop', 'leaveShip']);
    expect(model.orders.find((row) => row.order === 'goTo')?.control).toBe(
      messages().hud.vehiclePanel.refusals.carried,
    );
    expect(model.orders.find((row) => row.order === 'leaveShip')?.control).toBe(true);

    const atSea = withVehicle(carried, ship, (v) => (v.moored = false));
    expect(modelOf({ ...world, snapshot: atSea }, cart).orders.at(-1)?.control).toBe(
      messages().hud.vehiclePanel.refusals.carrierAtSea,
    );
  });

  it("shows another seat's vehicle with its owner line and no controls", () => {
    const world = vehiclesWorld();
    const ship = ownVehicle(world.sim, VEHICLE_SHIP_SMALL).entity;
    const model = modelOf(
      { ...world, ctx: { ...world.ctx, viewer: fixedViewerSeat(HUMAN_PLAYER + 1) } },
      ship,
    );
    expect(model.foreign).toBe(true);
    expect(model.meta).not.toBeNull();
    expect(model.orders).toEqual([]);
    expect(model.hold).toBeNull();
    expect(model.crew.assign).toBeNull();
    expect(model.crew.unload).toBeNull();
    const catapult = ownVehicle(world.sim, VEHICLE_CATAPULT).entity;
    const foreignSiege = modelOf(
      { ...world, ctx: { ...world.ctx, viewer: fixedViewerSeat(HUMAN_PLAYER + 1) } },
      catapult,
    );
    expect(foreignSiege.stance).toBeNull();
    expect(foreignSiege.attackOrders).toEqual([]);
  });
});

describe('vehicle status', () => {
  const base = {
    vehicleClass: 'cart' as const,
    task: 'none' as const,
    carrier: null,
    commanded: true,
    foreign: false,
    driving: false,
    moored: false,
    cargo: null,
  };
  const status = messages().hud.vehiclePanel.status;

  it('names the first state that holds, a missing driver only while the vehicle stands', () => {
    expect(vehicleStatus(base).label).toBe(status.stands);
    expect(vehicleStatus({ ...base, driving: true }).label).toBe(status.drives);
    expect(vehicleStatus({ ...base, vehicleClass: 'ship', driving: true }).label).toBe(status.sails);
    expect(vehicleStatus({ ...base, cargo: 'load' }).label).toBe(status.loads);
    expect(vehicleStatus({ ...base, task: 'interrupted' }).label).toBe(status.stopped);
    expect(vehicleStatus({ ...base, commanded: false, cargo: 'load' })).toEqual({
      label: status.noCommander.cart,
      tone: 'trouble',
      carrier: null,
    });
    expect(vehicleStatus({ ...base, commanded: false, task: 'attacks' }).label).toBe(status.attacks);
    // Another seat's vehicle is nobody's trouble.
    expect(vehicleStatus({ ...base, commanded: false, foreign: true }).tone).toBe('neutral');
  });
});

describe('vehicle panel orders', () => {
  it('arms a pick for a spot or target order and lights the button while it waits', () => {
    const cases = [
      ['goTo', 'vehicle-destination'],
      ['dock', 'vehicle-dock'],
      ['boardShip', 'vehicle-carrier'],
      ['attackSettler', 'vehicle-attack-settler'],
      ['attackBuilding', 'vehicle-attack-building'],
      ['attackVehicle', 'vehicle-attack-vehicle'],
      ['attackPosition', 'vehicle-attack-position'],
    ] as const;
    for (const [order, kind] of cases) {
      const pick = orderPick(7, order);
      expect(pick?.kind).toBe(kind);
      expect(armedVehiclePick(pick, 7)).toBe(order);
      expect(armedVehiclePick(pick, 8)).toBeNull();
    }
    expect(orderPick(7, 'stop')).toBeNull();
    expect(orderPick(7, 'leaveShip')).toBeNull();
    expect(armedVehiclePick({ kind: 'vehicle-rider', vehicle: 7 }, 7)).toBe('seatRider');
    expect(armedVehiclePick({ kind: 'vehicle-deck', vehicle: 7 }, 7)).toBe('loadVehicle');
    expect(armedVehiclePick({ kind: 'vehicle', settler: 7 }, 7)).toBeNull();
  });

  it("says why an order is refused, the pick's prompt while armed, and the right click otherwise", () => {
    const copy = messages().hud.vehiclePanel;
    expect(orderTexts({ order: 'goTo', control: 'no' }, 'cart', false)).toEqual({
      label: copy.orders.goTo,
      tooltip: 'no',
    });
    expect(orderTexts({ order: 'goTo', control: true }, 'ship', false).label).toBe(copy.orders.sail);
    expect(orderTexts({ order: 'goTo', control: true }, 'ship', false).tooltip).toContain(
      copy.orderHints.sail,
    );
    expect(orderTexts({ order: 'stop', control: true }, 'cart', true).tooltip).toContain(copy.orders.stop);
    expect(orderTexts({ order: 'stop', control: true }, 'cart', false).tooltip).toBe(copy.orders.stop);
  });

  it("turns the panel's presses into the vehicle's commands and refuses another seat's", () => {
    const world = vehiclesWorld();
    const cart = ownVehicle(world.sim, VEHICLE_OXCART).entity;
    const sent: PlayerCommand[] = [];
    const armed: PickMode[] = [];
    const cues: string[] = [];
    const host = (seat: number) =>
      vehiclePanelActions({
        snapshot: () => world.snapshot,
        viewer: fixedViewerSeat(seat),
        enqueue: (command) => sent.push(command),
        arm: (mode) => armed.push(mode),
        cue: (cue) => cues.push(cue),
      });
    const actions = host(HUMAN_PLAYER);
    actions.order(cart, 'stop');
    actions.order(cart, 'goTo');
    actions.setWanted(cart, 3, 5);
    actions.clearWanted(cart);
    actions.seatRider(cart);
    expect(sent).toEqual([
      { kind: 'stopVehicle', vehicle: cart },
      { kind: 'setVehicleWanted', vehicle: cart, goodType: 3, amount: 5 },
      { kind: 'clearVehicleWanted', vehicle: cart },
    ]);
    expect(armed).toEqual([
      { kind: 'vehicle-destination', vehicle: cart },
      { kind: 'vehicle-rider', vehicle: cart },
    ]);
    host(HUMAN_PLAYER + 1).order(cart, 'stop');
    expect(sent.length).toBe(3);
    expect(cues.at(-1)).toBe('fail');
  });

  it("browses the seat's own vehicles of the shown one's class", () => {
    const world = vehiclesWorld();
    const cart = ownVehicle(world.sim, VEHICLE_HANDCART).entity;
    const isCart = (typeId: number): boolean => {
      const type = world.sim.content.vehicles.find((v) => v.typeId === typeId);
      return type !== undefined && !systems.isShipVehicle(type) && !systems.isSiegeVehicle(type);
    };
    const carts = world.sim
      .vehiclesOf(HUMAN_PLAYER)
      .filter((v) => isCart(v.vehicleType))
      .map((v) => v.entity)
      .sort((a, b) => a - b);
    expect(carts.length).toBeGreaterThan(1);
    expect(vehiclePeersOf(world.snapshot, world.sim.content, cart)).toEqual(carts);
  });
});

describe('vehicle crew', () => {
  const rider = (entity: number, inside = true): VehicleRiderModel => ({
    entity,
    name: `R${entity}`,
    job: 'J',
    inside,
    look: 'man',
  });
  const crew = (over: Partial<VehicleCrewModel>): VehicleCrewModel => ({
    commander: rider(1),
    seats: [rider(2), null, null],
    count: 2,
    capacity: 4,
    deck: null,
    assign: true,
    leave: true,
    unload: true,
    load: null,
    unloadVehicle: null,
    ...over,
  });

  it('offers one free seat as the seat pick while the player may seat someone', () => {
    expect(seatWells(crew({})).map((well) => well.kind)).toEqual(['rider', 'add', 'free']);
    expect(seatWells(crew({ assign: 'full' })).map((well) => well.kind)).toEqual(['rider', 'free', 'free']);
    // Without a commander the commander's row offers the pick, which seats there first.
    expect(seatWells(crew({ commander: null })).map((well) => well.kind)).toEqual(['rider', 'free', 'free']);
  });

  it('names the commander as a link, walking while it is not aboard, or the seat to fill', () => {
    const model = (over: Partial<VehicleCrewModel>, foreign = false) => ({
      vehicleClass: 'cart' as const,
      foreign,
      crew: crew(over),
    });
    const copy = messages().hud.vehiclePanel;
    expect(commanderValue(model({ commander: rider(1, false) })).map((s) => s.text)).toEqual([
      'R1',
      copy.walking,
    ]);
    expect(commanderValue(model({}, true))[0]?.link).toBeUndefined();
    expect(commanderValue(model({ commander: null }))).toEqual([
      { text: copy.assignRole.cart, link: true, tone: 'missing', tooltip: copy.assignTooltip },
    ]);
  });
});

describe('vehicle hold', () => {
  const holdOf = (rows: VehicleHoldModel['rows']): VehicleHoldModel => ({
    slots: 30,
    rows,
    goods: [1, 2, 3].map((goodType) => ({ goodType, label: `G${goodType}`, category: 0 })),
    routed: false,
    cargoHand: true,
  });
  const row = (goodType: number, current: number, wanted: number, reserved: number) => ({
    goodType,
    label: `G${goodType}`,
    current,
    wanted,
    reserved,
  });

  it('echoes a wanted step until the live line leaves the value it had', () => {
    const state = createCargoState();
    state.show(9);
    const live = holdOf([row(1, 0, 2, 0)]);
    state.hold(1, 4, 2);
    state.hold(1, 5, 2);
    expect(state.lines(live).map((line) => line.wanted)).toEqual([5]);
    // The snapshot caught up: its value shows, the echo is gone.
    expect(state.lines(holdOf([row(1, 0, 5, 0)])).map((line) => line.wanted)).toEqual([5]);
    expect(state.lines(live).map((line) => line.wanted)).toEqual([2]);
  });

  it('keeps an added good at zero and every line in its place while counts change', () => {
    const state = createCargoState();
    state.show(9);
    state.lines(holdOf([row(2, 1, 1, 1)]));
    state.pin(3);
    state.pin(1);
    expect(state.lines(holdOf([row(2, 1, 1, 1)])).map((line) => [line.goodType, line.pinned])).toEqual([
      [2, false],
      [3, true],
      [1, true],
    ]);
    expect(state.lines(holdOf([row(1, 0, 4, 0), row(2, 1, 1, 1)])).map((line) => line.goodType)).toEqual([
      2, 3, 1,
    ]);
    // Another vehicle starts afresh.
    state.show(10);
    expect(state.lines(holdOf([row(2, 1, 1, 1)])).map((line) => line.goodType)).toEqual([2]);
  });

  it("reads a line's flow, its fill and its words", () => {
    expect(cargoFlow({ current: 3, reserved: 5 })).toEqual({ coming: 2, leaving: 0 });
    expect(cargoFlow({ current: 5, reserved: 2 })).toEqual({ coming: 0, leaving: 3 });
    expect(cargoFill({ current: 3, wanted: 12 })).toBe('25%');
    expect(cargoFill({ current: 3, wanted: 0 })).toBe('100%');
    expect(cargoFill({ current: 0, wanted: 0 })).toBe('0%');
    const copy = messages().hud.vehiclePanel;
    const words = cargoLineTooltip({ ...row(1, 3, 6, 5), pinned: false }, false);
    expect(words).toContain(copy.rowWanted.replace('{count}', '6'));
    expect(words).toContain(copy.rowComing.replace('{count}', '2'));
    expect(cargoLineTooltip({ ...row(1, 3, 6, 5), pinned: false }, true)).not.toContain(
      copy.rowWanted.replace('{count}', '6'),
    );
  });
});
