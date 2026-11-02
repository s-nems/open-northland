import type { UiCue } from '@open-northland/audio';
import { halfCellToScreen } from '@open-northland/render';
import { type Command, fx, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../../../src/game/sandbox/index.js';
import type { Pickable } from '../../../src/view/picking.js';
import { createAnsweredOrders } from '../../../src/view/unit-controls/orders/answered.js';
import { createUnitOrderController } from '../../../src/view/unit-controls/orders/controller.js';
import type { VehicleOrderController } from '../../../src/view/unit-controls/orders/vehicle.js';
import { createPickModeController, type PickModeDeps } from '../../../src/view/unit-controls/pick-mode.js';
import { createUnitSelection } from '../../../src/view/unit-controls/selection.js';
import { NO_TARGETS } from '../../support/pick-mode.js';
import { snapshotOf } from '../../support/snapshot.js';

/** An armed pick's aim names what its press does at the point: the label reads the aim, the press
 *  orders by the same lookups. */

const SOLDIER = 1;
const FOE = 30;
const DEER = 40;
const SHIP = 50;
const CART = 51;
const HOUSE = 60;
/** The client point every press and aim names; a target drawn there is under the cursor. */
const AT = 10;
const SPOT = { col: 3, row: 5 };
const MAP_SIZE = { width: 16, height: 16 };

const WORLD: WorldSnapshot = snapshotOf([
  {
    id: SOLDIER,
    components: { Settler: { jobType: null }, Position: { x: fx.fromInt(2), y: fx.fromInt(2) } },
  },
]);
const drawnHere = (ref: number, kind: NonNullable<Pickable['kind']>): Pickable => ({
  ref,
  x: AT,
  y: AT,
  kind,
});

function harness(
  lanes: { enemies?: Pickable[]; wildlife?: Pickable[]; vehicles?: Pickable[]; buildings?: Pickable[] } = {},
  vehicleOrders: Partial<VehicleOrderController> = {},
  answers: Pick<
    PickModeDeps,
    | 'signpostAnswerAt'
    | 'tradeHouseAttachAnswer'
    | 'vehicleAttachAnswer'
    | 'askAttachTradeHouse'
    | 'tradeShipPinAnswer'
    | 'askPinTradeShip'
    | 'cue'
  > = {},
) {
  const issued: Command[] = [];
  const selection = createUnitSelection(() => true);
  selection.apply([SOLDIER], false);
  const targets = {
    ...NO_TARGETS,
    enemies: () => lanes.enemies ?? [],
    wildlife: () => lanes.wildlife ?? [],
    owned: () => lanes.vehicles ?? [],
    buildings: () => lanes.buildings ?? [],
    ownedSettlersIn: () => [{ ref: SOLDIER, ...halfCellToScreen(4, 4) }],
  };
  const toWorld = (clientX: number, clientY: number) => ({ x: clientX, y: clientY });
  const orders = createUnitOrderController({
    answered: createAnsweredOrders(),
    selected: selection.ids,
    targets,
    snapshot: () => WORLD,
    content: sandboxContent(),
    mapSize: MAP_SIZE,
    toWorld,
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
  });
  const pickMode = createPickModeController({
    answered: createAnsweredOrders(),
    snapshot: () => WORLD,
    targets,
    content: sandboxContent(),
    mapSize: MAP_SIZE,
    toWorld,
    nodeAt: () => SPOT,
    enqueue: (command) => issued.push(command),
    orders: () => orders,
    vehicleOrders: () => vehicleOrders as VehicleOrderController,
    setArmedCursor: () => {},
    ...answers,
  });
  const press = () => pickMode.handleMouseDown({ clientX: AT, clientY: AT, button: 0 } as MouseEvent);
  return { pickMode, issued, press, aim: (primary = false) => pickMode.aimAt(AT, AT, primary) };
}

describe('an armed pick aims as its press orders', () => {
  it('names an attack-move over open ground as the march the press orders', () => {
    const h = harness();
    h.pickMode.arm({ kind: 'attack-move', units: [SOLDIER], vehicles: [] });
    expect(h.aim()).toEqual({ kind: 'attackMove' });
    expect(h.press()).toBe('ordered');
    expect(h.issued).toMatchObject([{ kind: 'attackMoveUnit', entity: SOLDIER }]);
  });

  it('marches an attack-move pressed on an enemy, as its aim names it', () => {
    const h = harness({ enemies: [drawnHere(FOE, 'settler')] });
    h.pickMode.arm({ kind: 'attack-move', units: [SOLDIER], vehicles: [] });
    expect(h.aim()).toEqual({ kind: 'attackMove' });
    expect(h.press()).toBe('ordered');
    expect(h.issued).toMatchObject([{ kind: 'attackMoveUnit', entity: SOLDIER }]);
  });

  it('names a wild animal under an attack-move as the creature it strikes', () => {
    const h = harness({ wildlife: [drawnHere(DEER, 'settler')] });
    h.pickMode.arm({ kind: 'attack-move', units: [SOLDIER], vehicles: [] });
    expect(h.aim()).toEqual({ kind: 'strike', target: DEER, creature: true });
  });

  it('aims a strike pick at nothing where no enemy of its kind stands, as its press misses', () => {
    const h = harness({ enemies: [drawnHere(FOE, 'vehicle')] });
    h.pickMode.arm({ kind: 'attack-settler', units: [SOLDIER] });
    expect(h.aim()).toBeNull();
    expect(h.press()).toBe('missed');
  });

  it('refuses a signpost where the rule turns the spot down, and nothing while disarmed', () => {
    const asked: { col: number; row: number }[] = [];
    const h = harness(
      {},
      {},
      {
        signpostAnswerAt: (col, row) => {
          asked.push({ col, row });
          return false;
        },
      },
    );
    expect(h.aim()).toBeNull();
    h.pickMode.arm({ kind: 'signpost', scout: SOLDIER });
    expect(h.aim()).toEqual({ kind: 'signpost', fits: false });
    expect(asked).toEqual([SPOT]);
  });

  it('offers the press whose rule has not answered yet, since the press still asks it', () => {
    const unanswered = () => undefined;
    const h = harness(
      { vehicles: [drawnHere(CART, 'vehicle')], buildings: [drawnHere(HOUSE, 'building')] },
      {},
      {
        signpostAnswerAt: unanswered,
        tradeHouseAttachAnswer: unanswered,
        vehicleAttachAnswer: unanswered,
        askAttachTradeHouse: async () => true,
      },
    );
    h.pickMode.arm({ kind: 'signpost', scout: SOLDIER });
    expect(h.aim()).toEqual({ kind: 'signpost', fits: true });
    h.pickMode.arm({ kind: 'trade-house', units: [SOLDIER] });
    expect(h.aim()).toMatchObject({ kind: 'building', building: HOUSE, fits: true });
    h.pickMode.arm({ kind: 'vehicle', settler: SOLDIER });
    expect(h.aim()).toEqual({ kind: 'board', fits: true });
  });

  it('refuses a trade stop and a seat once every answer turned them down', () => {
    const refused = () => false;
    const h = harness(
      { vehicles: [drawnHere(CART, 'vehicle')], buildings: [drawnHere(HOUSE, 'building')] },
      {},
      {
        tradeHouseAttachAnswer: refused,
        vehicleAttachAnswer: refused,
        askAttachTradeHouse: async () => false,
      },
    );
    h.pickMode.arm({ kind: 'trade-house', units: [SOLDIER] });
    expect(h.aim()).toMatchObject({ kind: 'building', building: HOUSE, fits: false });
    h.pickMode.arm({ kind: 'vehicle', settler: SOLDIER });
    expect(h.aim()).toEqual({ kind: 'board', fits: false });
  });

  it('refuses a deck load onto a ship the vehicle rule turns down', () => {
    const h = harness({ vehicles: [drawnHere(CART, 'vehicle')] }, { loadsInto: () => false });
    h.pickMode.arm({ kind: 'vehicle-deck', vehicle: SHIP });
    expect(h.aim()).toEqual({ kind: 'loadAboard', fits: false });
  });

  it('pins the ship the sim admits as the press lands, and refuses one it turns down', async () => {
    const lit = harness(
      { vehicles: [drawnHere(SHIP, 'vehicle')] },
      {},
      { tradeShipPinAnswer: () => true, askPinTradeShip: async () => true },
    );
    lit.pickMode.arm({ kind: 'trade-ship', trader: SOLDIER });
    expect(lit.aim()).toEqual({ kind: 'pinShip', fits: true });
    expect(lit.press()).toBe('ordered');
    await Promise.resolve();
    expect(lit.issued).toEqual([{ kind: 'setTradeShip', entity: SOLDIER, ship: SHIP }]);

    const cues: UiCue[] = [];
    const refused = harness(
      { vehicles: [drawnHere(SHIP, 'vehicle')] },
      {},
      {
        tradeShipPinAnswer: () => false,
        askPinTradeShip: async () => false,
        cue: (cue) => cues.push(cue),
      },
    );
    refused.pickMode.arm({ kind: 'trade-ship', trader: SOLDIER });
    expect(refused.aim()).toEqual({ kind: 'pinShip', fits: false });
    refused.press();
    await Promise.resolve();
    expect(refused.issued).toEqual([]);
    expect(cues).toEqual(['fail']);
  });

  it('misses and disarms where no ship lies under the trade-ship pick', () => {
    const h = harness({}, {}, { askPinTradeShip: async () => true });
    h.pickMode.arm({ kind: 'trade-ship', trader: SOLDIER });
    expect(h.aim()).toBeNull();
    expect(h.press()).toBe('missed');
    expect(h.pickMode.isArmed()).toBe(false);
  });

  it('lands the crew of a dock aimed with the primary modifier held where a berth fits', () => {
    const h = harness(
      {},
      { previewBerths: () => [{ vehicle: SHIP, col: 1, row: 1, dock: { col: 1, row: 0 } }] },
    );
    h.pickMode.arm({ kind: 'vehicle-dock', vehicles: [SHIP] });
    expect(h.aim(true)).toEqual({ kind: 'dock', fits: true, lands: true });
  });
});
