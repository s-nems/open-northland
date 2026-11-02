import {
  type Entity,
  entityById,
  type PlayerCommand,
  playerCommand,
  type Simulation,
  systems,
  type VehicleView,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_TRADER } from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER } from '../../../../src/game/rules.js';
import {
  spawnSettlerDirect,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_OXCART,
  VEHICLE_SHIP_SMALL,
} from '../../../../src/game/sandbox/index.js';
import { fixedViewerSeat } from '../../../../src/game/viewer-seat.js';
import { buildUnitPanelModel, type UnitPanelModelContext } from '../../../../src/hud/details-panel/index.js';
import type {
  VehicleCrewModel,
  VehicleHoldModel,
  VehiclePanelModel,
  VehicleRiderModel,
} from '../../../../src/hud/details-panel/model/index.js';
import {
  vehicleOrders,
  vehiclePanelModel,
  vehicleStatus,
} from '../../../../src/hud/details-panel/model/vehicle.js';
import { createCargoState } from '../../../../src/hud/dom/vehicle-panel/cargo.js';
import {
  commanderCaption,
  commanderWell,
  riderTooltip,
  seatWells,
  wellPress,
} from '../../../../src/hud/dom/vehicle-panel/crew.js';
import { cargoFill, cargoFlow, cargoLineTooltip } from '../../../../src/hud/dom/vehicle-panel/hold.js';
import { orderTexts } from '../../../../src/hud/dom/vehicle-panel/portrait.js';
import { formatMessage, messages } from '../../../../src/i18n/index.js';
import { tradeSeaScene, tradeSeaShip } from '../../../../src/scenes/economy/trade-sea.js';
import { tradeSeaPinScene } from '../../../../src/scenes/economy/trade-sea-pin.js';
import { createSceneSim } from '../../../../src/scenes/index.js';
import { vehiclesScene } from '../../../../src/scenes/vehicles/vehicles.js';
import {
  armedVehiclePick,
  orderPick,
  vehiclePanelActions,
  vehiclePeersOf,
} from '../../../../src/view/unit-controls/panels/vehicle.js';
import type { PickMode } from '../../../../src/view/unit-controls/pick-mode.js';
import { ctxOf } from '../../../support/sandbox.js';

/** The panel context with the sim's trader seam, which the Trade section reads. */
const tradeCtxOf = (sim: Simulation): UnitPanelModelContext => ({
  ...ctxOf(sim),
  traderView: (entity) => sim.traderView(entity as Entity),
});

/** The vehicles scene one tick in: the carrier attached to the handcart, the ox cart loaded with wood and
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
  it('shows a crewed cart with its commander as the driver and its drive orders', () => {
    const world = vehiclesWorld();
    const cart = ownVehicle(world.sim, VEHICLE_HANDCART);
    const model = modelOf(world, cart.entity);
    expect(model.vehicleClass).toBe('cart');
    expect(model.title).toBe(messages().goods.handcart);
    expect(model.crew.commander?.entity).toBe(cart.commander);
    expect(model.crew.seats).toEqual([]);
    expect(orders(model)).toEqual(['goTo', 'stop', 'boardShip']);
    expect(model.orders.every((row) => row.control === true)).toBe(true);
    expect(model.trade).toBeNull();
    expect(model.health).toEqual({ hitpoints: cart.hitpoints, max: cart.maxHitpoints });
  });

  it("shows the cart a trader pulls with the trader's Handel and a read-only hold", () => {
    const sim = createSceneSim(vehiclesScene);
    const cart = ownVehicle(sim, VEHICLE_OXCART);
    const trader = spawnSettlerDirect(sim, JOB_TRADER, 6, 12, HUMAN_PLAYER);
    sim.enqueue(
      playerCommand(HUMAN_PLAYER, { kind: 'attachToVehicle', entity: trader, vehicle: cart.entity }),
    );
    sim.step();
    const model = modelOf({ snapshot: sim.snapshot(), ctx: tradeCtxOf(sim) }, cart.entity);
    expect(model.hauler?.entity).toBe(trader);
    expect(model.trade?.entityId).toBe(trader);
    expect(model.hold?.routed).toBe(true);
    const refusal = messages().hud.vehiclePanel.refusals.hauled;
    expect(model.orders.every((row) => row.control === refusal)).toBe(true);
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

    const unmoored = withVehicle(world.snapshot, ship.entity, (v) => (v.moored = false));
    const atSea = modelOf({ ...world, snapshot: unmoored }, ship.entity);
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
    hauler: null,
    commanded: true,
    foreign: false,
    pinned: false,
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
    // A pinned ship waits for its trader at every shore, which is no trouble either.
    expect(vehicleStatus({ ...base, vehicleClass: 'ship', commanded: false, pinned: true }).tone).toBe(
      'neutral',
    );
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

  it("says why an order is refused, the pick's prompt while armed, and the name otherwise", () => {
    const copy = messages().hud.vehiclePanel;
    expect(orderTexts({ order: 'goTo', control: 'no' }, 'cart', false, 'Z')).toEqual({
      label: copy.orders.goTo,
      tooltip: 'no',
    });
    expect(orderTexts({ order: 'goTo', control: true }, 'ship', false, 'Z')).toEqual({
      label: copy.orders.sail,
      tooltip: copy.orders.sail,
    });
    expect(orderTexts({ order: 'stop', control: true }, 'cart', true, 'Z').tooltip).toContain(
      copy.orders.stop,
    );
    expect(orderTexts({ order: 'stop', control: true }, 'cart', false, 'Z').tooltip).toBe(copy.orders.stop);
    // The dock order names its key and the Ctrl/Cmd click that also lands the crew.
    expect(orderTexts({ order: 'dock', control: true }, 'ship', false, 'Z').tooltip).toBe(
      formatMessage(copy.dockTooltip, { order: copy.orders.dock, key: 'Z' }),
    );
    expect(copy.dockTooltip).toContain('Ctrl/Cmd');
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
    // Without a commander the commander's well offers the pick, which seats there first.
    expect(seatWells(crew({ commander: null })).map((well) => well.kind)).toEqual(['rider', 'free', 'free']);
  });

  it("marks the commander's well: the rider, the seat pick, or a seat nobody may fill", () => {
    expect(commanderWell(crew({}))).toEqual({ kind: 'rider', rider: rider(1) });
    expect(commanderWell(crew({ commander: null })).kind).toBe('add');
    expect(commanderWell(crew({ commander: null, assign: 'full' })).kind).toBe('free');
    expect(commanderWell(crew({ commander: null, assign: null })).kind).toBe('free');
  });

  it("captions a land vehicle's commander by role with the trade, the walk or the seat to fill", () => {
    const copy = messages().hud.vehiclePanel;
    const caption = (over: Partial<VehicleCrewModel>) =>
      commanderCaption({ vehicleClass: 'cart', crew: crew(over) });
    expect(caption({})).toEqual({ role: copy.roles.cart, detail: 'J', missing: false });
    expect(caption({ commander: rider(1, false) }).detail).toBe(copy.walking);
    expect(caption({ commander: null })).toEqual({
      role: copy.roles.cart,
      detail: copy.assignRole.cart,
      missing: true,
    });
    expect(caption({ commander: null, assign: null }).missing).toBe(false);
  });

  it('selects a rider on a click, steps it out on a Ctrl click and seats someone from the pick well', () => {
    const own = { foreign: false, crew: crew({}) };
    const riderWell = { kind: 'rider', rider: rider(2) } as const;
    expect(wellPress(riderWell, own, false)).toBe('select');
    expect(wellPress(riderWell, own, true)).toBe('leave');
    expect(wellPress(riderWell, { foreign: false, crew: crew({ leave: 'at sea' }) }, true)).toBe('refuse');
    expect(wellPress({ kind: 'add' }, own, true)).toBe('seat');
    expect(wellPress({ kind: 'free' }, own, false)).toBeNull();
    expect(wellPress(riderWell, { foreign: true, crew: crew({ leave: null }) }, false)).toBeNull();
  });

  it('names the commander by role and name, an ordinary rider by name, a foreign one by trade', () => {
    const copy = messages().hud.vehiclePanel;
    expect(riderTooltip(rider(1), false, copy.roles.ship)).toBe(`${copy.roles.ship} · R1`);
    expect(riderTooltip(rider(2, false), false, null)).toBe('R2');
    expect(riderTooltip(rider(2), true, null)).toBe('J');
  });
});

describe('vehicle hold', () => {
  const holdOf = (rows: VehicleHoldModel['rows']): VehicleHoldModel => ({
    slots: 30,
    rows,
    goods: [1, 2, 3].map((goodType) => ({ goodType, label: `G${goodType}`, category: 0 })),
    routed: false,
    cargoHand: true,
    hauled: false,
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

describe('a hauling cart riding a ship', () => {
  it('refuses to leave the ship, moored or not: it comes off with its puller', () => {
    const orders = vehicleOrders({
      vehicleClass: 'cart',
      commanded: false,
      carried: true,
      carrierMoored: true,
      animalMissing: false,
      hauled: true,
    }).orders;
    expect(orders.find((row) => row.order === 'leaveShip')?.control).toBe(
      messages().hud.vehiclePanel.refusals.hauled,
    );
  });
});

describe('a ship pinned to a trader', () => {
  function shipPanel(scene: typeof tradeSeaScene): VehiclePanelModel {
    const sim = createSceneSim(scene);
    sim.run(1);
    const ship = tradeSeaShip(sim);
    const entity = ship === undefined ? undefined : entityById(sim.snapshot(), ship);
    if (entity === undefined) throw new Error('expected the scene ship');
    return vehiclePanelModel(tradeCtxOf(sim), sim.snapshot(), entity);
  }

  it('names its trader and reads as no pulled cart', () => {
    const model = shipPanel(tradeSeaScene);
    expect(model.tradePin?.name).toBeTruthy();
    expect(model.hauler).toBeNull();
    expect(model.trade).toBeNull();
  });

  it("shows the trader ashore in the captain's well, outside, and a Ctrl click refuses", () => {
    const model = shipPanel(tradeSeaScene);
    expect(model.crew.commander?.entity).toBe(model.tradePin?.entity);
    expect(model.crew.commander?.inside).toBe(false);
    expect(model.crew.leave).toBe(messages().hud.vehiclePanel.refusals.pinned);
    expect(wellPress(commanderWell(model.crew), model, true)).toBe('refuse');
  });

  it('takes go to and dock while it lies moored for the trader ashore, and refuses them at sea', () => {
    const sim = createSceneSim(tradeSeaScene);
    sim.run(1);
    const ship = tradeSeaShip(sim);
    if (ship === undefined) throw new Error('expected the scene ship');
    const control = (snapshot: WorldSnapshot, order: string) =>
      modelOf({ snapshot, ctx: tradeCtxOf(sim) }, ship).orders.find((row) => row.order === order)?.control;
    const snapshot = sim.snapshot();
    expect(control(snapshot, 'goTo')).toBe(true);
    expect(control(snapshot, 'dock')).toBe(true);
    const atSea = withVehicle(snapshot, ship, (v) => {
      v.moored = false;
    });
    expect(control(atSea, 'goTo')).toBe(messages().hud.vehiclePanel.refusals.noCommander.ship);
  });

  it('leaves its hold, its seats and its deck to the route', () => {
    const { hold, crew } = shipPanel(tradeSeaScene);
    const { pinned } = messages().hud.vehiclePanel.refusals;
    expect(hold?.routed).toBe(true);
    expect([crew.assign, crew.load, crew.unloadVehicle]).toEqual([pinned, pinned, pinned]);
  });

  it('frees all of that on a ship nobody pinned', () => {
    const { tradePin, hold, crew } = shipPanel(tradeSeaPinScene);
    expect(tradePin).toBeNull();
    expect(hold?.routed).toBe(false);
    expect(crew.assign).toBe(true);
  });
});
