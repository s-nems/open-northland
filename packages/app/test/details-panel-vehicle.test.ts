import {
  components,
  type Entity,
  playerCommand,
  type Simulation,
  TICKS_PER_SECOND,
  type VehicleView,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_WAREHOUSE_00,
  GOOD_IRON,
  placeBuiltSandboxBuilding,
  VEHICLE_CATAPULT,
  VEHICLE_HANDCART,
  VEHICLE_OXCART,
  VEHICLE_SHIP_SMALL,
} from '../src/game/sandbox/index.js';
import { applyPanelClick, type PanelClickActions } from '../src/hud/details-panel/click-actions.js';
import {
  hitButton,
  hitStockTab,
  hitTradeAttach,
  hitVehicleCargoStep,
  hitVehicleCrew,
  hitVehicleOrder,
  tooltipTextAt,
  visibleCargoRows,
} from '../src/hud/details-panel/hit-test.js';
import { buildUnitPanelModel, type UnitPanelModelContext } from '../src/hud/details-panel/index.js';
import type { TradeLayout } from '../src/hud/details-panel/layout/index.js';
import type { VehiclePanelModel } from '../src/hud/details-panel/model/index.js';
import {
  NO_MODIFIERS,
  NO_PANEL_HOVER,
  panelClickAt,
  panelHoverAt,
  sameHover,
  WANTED_BIG_STEP,
} from '../src/hud/details-panel/pointer-intent.js';
import type { PanelView } from '../src/hud/details-panel/selection-view.js';
import { ALL_STOCK_TAB } from '../src/hud/details-panel/stock-tabs.js';
import { messages } from '../src/i18n/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sceneTrader, tradeScene } from '../src/scenes/trade.js';
import { vehiclesScene } from '../src/scenes/vehicles.js';
import { center, viewOfKind } from './support/details-panel.js';
import { ctxOf } from './support/sandbox.js';

/** The panel context with the sim's trader seam, which the Handel section reads. */
const tradeCtxOf = (sim: Simulation): UnitPanelModelContext => ({
  ...ctxOf(sim),
  traderView: (entity) => sim.traderView(entity as Entity),
});

/** The vehicles scene one tick in: the trader attached to the handcart, the ox cart loaded with wood,
 *  the catapult mid-attack and the ships moored. */
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

function vehicleModel(world: ReturnType<typeof vehiclesWorld>, type: number): VehiclePanelModel {
  const model = buildUnitPanelModel(world.snapshot, new Set([ownVehicle(world.sim, type).entity]), world.ctx);
  if (model.kind !== 'vehicle') throw new Error(`expected a vehicle model, got ${model.kind}`);
  return model;
}

const vehicleView = (model: VehiclePanelModel): Extract<PanelView, { kind: 'vehicle' }> =>
  viewOfKind(model, 'vehicle');

/** Long enough into the trade scene for the trader to ride its cart with the route set. */
const TRADE_SCENE_RIDE_TICKS = TICKS_PER_SECOND * 12;
/** A second warehouse of the player's, between the trade scene's home and the foreign post. */
const SECOND_WAREHOUSE_AT = { x: 11, y: 5 } as const;
const SECOND_WAREHOUSE_IRON = 3;

const orders = (model: VehiclePanelModel): string[] => model.orders.map((row) => row.order);

describe('vehicle panel model', () => {
  it('opens the order window for one vehicle alone and counts a group of them or one boxed with settlers', () => {
    const world = vehiclesWorld();
    const catapult = ownVehicle(world.sim, VEHICLE_CATAPULT).entity;
    const cart = ownVehicle(world.sim, VEHICLE_HANDCART).entity;
    const settler = world.snapshot.entities.find(
      (e) => e.components.Settler !== undefined && e.components.Position !== undefined,
    );
    if (settler === undefined) throw new Error('no settler on the map');
    const modelOf = (ids: readonly number[]) => buildUnitPanelModel(world.snapshot, new Set(ids), world.ctx);
    expect(modelOf([catapult]).kind).toBe('vehicle');
    expect(modelOf([catapult, cart])).toEqual({ kind: 'generic', count: 2 });
    expect(modelOf([catapult, settler.id])).toEqual({ kind: 'generic', count: 2 });
  });

  it('titles a cart by its type, lists its trader as the commander and offers the cart orders', () => {
    const world = vehiclesWorld();
    const model = vehicleModel(world, VEHICLE_HANDCART);
    const cart = ownVehicle(world.sim, VEHICLE_HANDCART);
    expect(model.title).toBe(messages().goods.handcart);
    expect(model.crew.map((row) => [row.role, row.entity, row.inside])).toEqual([
      ['commander', cart.commander, false],
    ]);
    expect(model.crewCapacity).toBe(cart.passengerCapacity);
    expect(orders(model)).toEqual(['goTo', 'stop', 'unloadPeople', 'loadIntoShip', 'unloadGoods']);
    expect(model.orders.find((row) => row.order === 'goTo')?.enabled).toBe(true);
    expect(model.stance).toBeNull();
    expect(model.capacityLabel).toContain(`0/${cart.stockSlots}`);
    expect(model.health?.hover).toBe(`${cart.hitpoints}/${cart.maxHitpoints}`);
  });

  it('lists a loaded hold on the all tab and every carriable good on the category tabs', () => {
    const world = vehiclesWorld();
    const model = vehicleModel(world, VEHICLE_OXCART);
    const cart = ownVehicle(world.sim, VEHICLE_OXCART);
    const view = vehicleView(model);
    const all = visibleCargoRows(view, ALL_STOCK_TAB);
    expect(all.map((row) => [row.goodType, row.current])).toEqual(
      cart.stock.map((line) => [line.good, line.current]),
    );
    const listed = new Set(model.cargo.map((row) => row.goodType));
    for (const line of cart.stock) expect(listed.has(line.good)).toBe(true);
    expect(model.cargo.length).toBeGreaterThan(all.length);
    // A cart with no commander cannot drive, but its hold still takes requests.
    expect(model.orders.find((row) => row.order === 'goTo')?.enabled).toBe(false);
    expect(model.orders.find((row) => row.order === 'unloadGoods')?.enabled).toBe(true);
  });

  it('gives a catapult the attack orders and its stances, lit on the one it holds, and no hold', () => {
    const world = vehiclesWorld();
    const model = vehicleModel(world, VEHICLE_CATAPULT);
    expect(orders(model)).toEqual([
      'goTo',
      'stop',
      'unloadPeople',
      'loadIntoShip',
      'attackInhabitants',
      'attackBuilding',
      'attackVehicle',
      'attackPosition',
      'stanceAttack',
      'stanceDefence',
      'stanceHold',
    ]);
    expect(model.stance).toBe('hold');
    expect(model.orders.filter((row) => row.active).map((row) => row.order)).toEqual(['stanceHold']);
    expect(model.task).toBe('attacks');
    expect(model.cargo).toEqual([]);
    expect(model.capacityLabel).toBeNull();
    expect(vehicleView(model).layout.cargo).toBeNull();
  });

  it('gives a ship the mooring order instead of the carrier pair', () => {
    const world = vehiclesWorld();
    const model = vehicleModel(world, VEHICLE_SHIP_SMALL);
    expect(orders(model)).toEqual(['goTo', 'stop', 'dock', 'unloadPeople', 'unloadGoods']);
    expect(model.crew.length).toBe(3);
  });

  it('lands a ship crew only while it lies moored', () => {
    const world = vehiclesWorld();
    const unload = (model: VehiclePanelModel) => model.orders.find((row) => row.order === 'unloadPeople');
    expect(unload(vehicleModel(world, VEHICLE_SHIP_SMALL))?.enabled).toBe(true);
    const ship = ownVehicle(world.sim, VEHICLE_SHIP_SMALL).entity;
    const snapshot = structuredClone(world.snapshot);
    const vehicle = snapshot.entities.find((e) => e.id === ship)?.components.Vehicle as { moored: boolean };
    vehicle.moored = false;
    expect(unload(vehicleModel({ ...world, snapshot }, VEHICLE_SHIP_SMALL))?.enabled).toBe(false);
  });
});

describe('vehicle panel trade tab', () => {
  /** The snapshot with `trader` seated in the first passenger slot of `vehicle`. */
  const seatedIn = (snapshot: WorldSnapshot, vehicle: number, trader: number): WorldSnapshot => {
    const copy = structuredClone(snapshot);
    const v = copy.entities.find((e) => e.id === vehicle)?.components.Vehicle as {
      passengers: ({ entity: number; inside: boolean } | null)[];
    };
    v.passengers[0] = { entity: trader, inside: true };
    return copy;
  };

  it("shows a riding trader's route on a cart, addressed to the trader", () => {
    const world = vehiclesWorld();
    const cart = ownVehicle(world.sim, VEHICLE_HANDCART);
    const model = vehicleModel(world, VEHICLE_HANDCART);
    expect(cart.commander).not.toBeNull();
    expect(model.trade?.trader).toBe(cart.commander);
    expect(model.trade?.panel.canAttach).toBe(true);
    expect(vehicleView(model).layout.trade).not.toBeNull();
  });

  it('shows no trade tab on a cart without a trader or on a ship, even one a trader rides', () => {
    const world = vehiclesWorld();
    expect(vehicleModel(world, VEHICLE_OXCART).trade).toBeNull();
    expect(vehicleModel(world, VEHICLE_SHIP_SMALL).trade).toBeNull();
    expect(vehicleView(vehicleModel(world, VEHICLE_SHIP_SMALL)).layout.trade).toBeNull();

    const trader = ownVehicle(world.sim, VEHICLE_HANDCART).commander;
    if (trader === null) throw new Error('expected the handcart trader');
    const ship = ownVehicle(world.sim, VEHICLE_SHIP_SMALL).entity;
    const oxcart = ownVehicle(world.sim, VEHICLE_OXCART).entity;
    expect(
      vehicleModel({ ...world, snapshot: seatedIn(world.snapshot, ship, trader) }, VEHICLE_SHIP_SMALL).trade,
    ).toBeNull();
    expect(
      vehicleModel({ ...world, snapshot: seatedIn(world.snapshot, oxcart, trader) }, VEHICLE_OXCART).trade
        ?.trader,
    ).toBe(trader);
  });

  it('arms the house pick for the trader from the attach button', () => {
    const world = vehiclesWorld();
    const model = vehicleModel(world, VEHICLE_HANDCART);
    const view = vehicleView(model);
    const attach = view.layout.trade?.attach;
    if (attach == null || model.trade === null) throw new Error('expected the attach row');
    const at = center(attach.button.rect);
    expect(hitTradeAttach(view, at.x, at.y)).toBe(true);
    expect(hitButton(view, at.x, at.y)?.action).toBe('attach-trade-house');
    expect(panelClickAt(view, at.x, at.y, NO_MODIFIERS, ALL_STOCK_TAB)).toEqual({
      kind: 'attachTradeHouse',
      entityId: model.trade.trader,
    });
    expect(tooltipTextAt(view, at.x, at.y, 1, ALL_STOCK_TAB)).toBe(messages().hud.tradeAttachHouseHint);
    expect(panelHoverAt(view, at.x, at.y, ALL_STOCK_TAB).action).toBe('attach-trade-house');
  });

  /** The trade scene's cart panel once the trader rides it. */
  const tradePanel = (sim: Simulation): { trader: Entity; view: PanelView; trade: TradeLayout } => {
    const trader = sceneTrader(sim);
    const cart = trader === undefined ? undefined : sim.traderView(trader)?.cart?.entity;
    if (trader === undefined || cart === undefined) throw new Error('expected the trader on its cart');
    const model = buildUnitPanelModel(sim.snapshot(), new Set([cart]), tradeCtxOf(sim));
    if (model.kind !== 'vehicle') throw new Error(`expected a vehicle model, got ${model.kind}`);
    expect(model.trade?.trader).toBe(trader);
    const view = vehicleView(model);
    const trade = view.layout.trade;
    if (trade === null) throw new Error('expected the Handel section');
    return { trader, view, trade };
  };

  it("turns an own route's import marks into the trader's orders", () => {
    const sim = createSceneSim(tradeScene);
    sim.run(TRADE_SCENE_RIDE_TICKS);
    const trader = sceneTrader(sim);
    const post =
      trader === undefined ? undefined : sim.traderView(trader)?.stops.find((s) => s.foreign)?.house;
    if (trader === undefined || post === undefined) throw new Error('expected the foreign route');
    const second = placeBuiltSandboxBuilding(
      sim,
      BUILDING_WAREHOUSE_00,
      SECOND_WAREHOUSE_AT.x,
      SECOND_WAREHOUSE_AT.y,
      HUMAN_PLAYER,
    );
    components.setStockAmount(sim.world, second, GOOD_IRON, SECOND_WAREHOUSE_IRON);
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'detachTradeHouse', entity: trader, house: post }));
    sim.enqueue(playerCommand(HUMAN_PLAYER, { kind: 'attachTradeHouse', entity: trader, house: second }));
    sim.step();
    const { view, trade } = tradePanel(sim);

    expect(trade.offers).toEqual([]);
    const mark = trade.stops.flatMap((stop) => stop.imports)[0];
    if (mark === undefined) throw new Error('expected an import mark');
    const onMark = center(mark.rect);
    expect(panelClickAt(view, onMark.x, onMark.y, NO_MODIFIERS, ALL_STOCK_TAB)).toEqual({
      kind: 'setTradeImport',
      entityId: trader,
      house: mark.house,
      goodType: mark.goodType,
      on: !mark.selected,
    });
    expect(tooltipTextAt(view, onMark.x, onMark.y, 1, ALL_STOCK_TAB)).toContain(mark.label);
    expect(panelHoverAt(view, onMark.x, onMark.y, ALL_STOCK_TAB).tradeImport).toEqual({
      house: mark.house,
      goodType: mark.goodType,
    });
  });

  it("turns a foreign route's agreements and detach buttons into the trader's orders, with no import mark", () => {
    const sim = createSceneSim(tradeScene);
    sim.run(TRADE_SCENE_RIDE_TICKS);
    const { trader, view, trade } = tradePanel(sim);

    expect(trade.stops.flatMap((stop) => stop.imports)).toEqual([]);
    expect(trade.offersCaption).not.toBeNull();
    const offer = trade.offers[0];
    if (offer === undefined) throw new Error('expected an agreement row');
    const onOffer = center(offer.rect);
    expect(panelClickAt(view, onOffer.x, onOffer.y, NO_MODIFIERS, ALL_STOCK_TAB)).toEqual({
      kind: 'setTradeAgreement',
      entityId: trader,
      agreement: offer.selected ? -1 : offer.index,
    });

    const stop = trade.stops[0];
    if (stop === undefined) throw new Error('expected a route stop');
    const onDetach = center(stop.detach.rect);
    expect(panelClickAt(view, onDetach.x, onDetach.y, NO_MODIFIERS, ALL_STOCK_TAB)).toEqual({
      kind: 'detachTradeHouse',
      entityId: trader,
      house: stop.house,
    });
    expect(tooltipTextAt(view, onDetach.x, onDetach.y, 1, ALL_STOCK_TAB)).toBe(
      messages().hud.tradeDetachHouse,
    );
  });
});

describe('vehicle panel pointer intents', () => {
  it('turns an order button into that order and a crew row into a selection', () => {
    const world = vehiclesWorld();
    const model = vehicleModel(world, VEHICLE_HANDCART);
    const view = vehicleView(model);
    const button = view.layout.orderButtons.find((b) => b.action === 'vehicle-goTo');
    if (button === undefined) throw new Error('expected the go-to button');
    const at = center(button.rect);
    expect(hitVehicleOrder(view, at.x, at.y)).toBe('goTo');
    expect(hitButton(view, at.x, at.y)?.enabled).toBe(true);
    expect(panelClickAt(view, at.x, at.y, NO_MODIFIERS, ALL_STOCK_TAB)).toEqual({
      kind: 'vehicleOrder',
      entityId: model.entityId,
      order: 'goTo',
    });
    expect(tooltipTextAt(view, at.x, at.y, 1, ALL_STOCK_TAB)).toBe(messages().hud.vehicleOrderGoToHint);

    const row = view.layout.crewRows[0];
    if (row === undefined) throw new Error('expected a crew row');
    const on = center(row.rect);
    expect(hitVehicleCrew(view, on.x, on.y)).toBe(row.entity);
    expect(panelClickAt(view, on.x, on.y, NO_MODIFIERS, ALL_STOCK_TAB)).toEqual({
      kind: 'selectEntity',
      entityId: row.entity,
    });
    expect(tooltipTextAt(view, on.x, on.y, 1, ALL_STOCK_TAB)).toBe(messages().hud.vehicleSelectHint);
  });

  it('steps a wanted amount by one, by ten with Shift, and never below zero', () => {
    const world = vehiclesWorld();
    const model = vehicleModel(world, VEHICLE_OXCART);
    const view = vehicleView(model);
    const row = visibleCargoRows(view, ALL_STOCK_TAB)[0];
    const cell = view.layout.cargoCells[0];
    if (row === undefined || cell === undefined) throw new Error('expected a loaded cargo cell');
    expect(row.wanted).toBe(0);
    const more = center(cell.more);
    const less = center(cell.less);
    expect(hitVehicleCargoStep(view, more.x, more.y, ALL_STOCK_TAB)).toEqual({ row, step: 1 });
    expect(panelClickAt(view, more.x, more.y, NO_MODIFIERS, ALL_STOCK_TAB)).toEqual({
      kind: 'setVehicleWanted',
      entityId: model.entityId,
      goodType: row.goodType,
      amount: 1,
    });
    expect(panelClickAt(view, more.x, more.y, { toggle: false, bigStep: true }, ALL_STOCK_TAB)).toEqual({
      kind: 'setVehicleWanted',
      entityId: model.entityId,
      goodType: row.goodType,
      amount: WANTED_BIG_STEP,
    });
    expect(panelClickAt(view, less.x, less.y, { toggle: false, bigStep: true }, ALL_STOCK_TAB)).toEqual({
      kind: 'setVehicleWanted',
      entityId: model.entityId,
      goodType: row.goodType,
      amount: 0,
    });
    expect(tooltipTextAt(view, more.x, more.y, 1, ALL_STOCK_TAB)).toContain(row.label);
    const plate = center(cell.plate);
    expect(tooltipTextAt(view, plate.x, plate.y, 1, ALL_STOCK_TAB)).toContain(`${row.current}`);

    const hover = panelHoverAt(view, more.x, more.y, ALL_STOCK_TAB);
    expect(hover.cargoStep).toEqual({ goodType: row.goodType, step: 1 });
    expect(sameHover(hover, NO_PANEL_HOVER)).toBe(false);
  });

  it('switches the hold to a category tab, whose cells then name that category', () => {
    const world = vehiclesWorld();
    const view = vehicleView(vehicleModel(world, VEHICLE_HANDCART));
    const tab = view.layout.cargoTabHits[1];
    if (tab === undefined) throw new Error('expected a category tab');
    const at = center(tab);
    expect(hitStockTab(view, at.x, at.y)).toBe(1);
    expect(panelClickAt(view, at.x, at.y, NO_MODIFIERS, ALL_STOCK_TAB)).toEqual({ kind: 'stockTab', tab: 1 });
    expect(visibleCargoRows(view, ALL_STOCK_TAB)).toEqual([]);
    const rows = visibleCargoRows(view, 1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.category === 0)).toBe(true);
  });

  it('routes the vehicle clicks to their optional handlers', () => {
    const calls: unknown[][] = [];
    const record =
      (name: string) =>
      (...args: unknown[]): void => {
        calls.push([name, ...args]);
      };
    const actions: PanelClickActions = {
      onDemolish: record('onDemolish'),
      onUpgrade: record('onUpgrade'),
      onCancelUpgrade: record('onCancelUpgrade'),
      onDemolishSignpost: record('onDemolishSignpost'),
      onSetDefenceMode: record('onSetDefenceMode'),
      onSetGatherGood: record('onSetGatherGood'),
      onSetCraftGoods: record('onSetCraftGoods'),
      onSetHouseholdGoodUse: record('onSetHouseholdGoodUse'),
      onCenterOnEntity: record('onCenterOnEntity'),
      onSelectEntity: record('onSelectEntity'),
      onVehicleOrder: record('onVehicleOrder'),
      onSetVehicleWanted: record('onSetVehicleWanted'),
    };
    const select = (): void => undefined;
    applyPanelClick({ kind: 'selectEntity', entityId: 4 }, actions, select);
    applyPanelClick({ kind: 'vehicleOrder', entityId: 5, order: 'dock' }, actions, select);
    applyPanelClick({ kind: 'setVehicleWanted', entityId: 5, goodType: 7, amount: 3 }, actions, select);
    expect(calls).toEqual([
      ['onSelectEntity', 4],
      ['onVehicleOrder', 5, 'dock'],
      ['onSetVehicleWanted', 5, 7, 3],
    ]);
  });
});
