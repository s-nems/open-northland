import { halfCellToScreen } from '@open-northland/render';
import { type Entity, fx, MAX_UNIT_ORDER_MEMBERS, type PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent, VEHICLE_CATAPULT } from '../../../../src/game/sandbox/index.js';
import { fixedViewerSeat } from '../../../../src/game/viewer-seat.js';
import { DEFAULT_KEY_BINDINGS } from '../../../../src/hud/keybindings.js';
import { createAnsweredOrders } from '../../../../src/view/unit-controls/orders/answered.js';
import { createUnitOrderController } from '../../../../src/view/unit-controls/orders/controller.js';
import { enqueueArmyOrder } from '../../../../src/view/unit-controls/orders/group.js';
import { createOverviewOrders } from '../../../../src/view/unit-controls/orders/overview.js';
import { issueRingCommand } from '../../../../src/view/unit-controls/orders/ring-commands.js';
import { createVehicleOrderController } from '../../../../src/view/unit-controls/orders/vehicle.js';
import { createPickModeController } from '../../../../src/view/unit-controls/pick-mode.js';
import { withPointHits } from '../../../support/point-hits.js';
import { rightClickSettlers, rightClickVehicles } from '../../../support/right-click.js';
import { snapshotOf } from '../../../support/snapshot.js';
import { STILL_CAMERA } from '../../../support/still-camera.js';

const COUNT = 1000;
const TARGET = { col: 150, row: 80 };
const POINT = halfCellToScreen(TARGET.col, TARGET.row);
const ENEMY = 5000;
const HOUSE = 6000;

/** `commanded`: the first settler commands the first vehicle, standing beside it. `house`: an own
 *  building stands under the click. */
function harness(
  enemy = false,
  count = COUNT,
  posted = false,
  vehicleCount = 0,
  commanded = false,
  house = false,
) {
  const units = Array.from({ length: count }, (_, i) => ({
    ref: i + 1,
    ...halfCellToScreen(2 + 2 * (i % 40), 2 + 2 * Math.floor(i / 40)),
  }));
  const vehicles = Array.from({ length: vehicleCount }, (_, i) => ({
    id: 100000 + i,
    components: {
      Vehicle: {
        vehicleType: VEHICLE_CATAPULT,
        tribe: 1,
        carrier: null,
        passengers: commanded && i === 0 ? [{ entity: 1, inside: false }] : [],
      },
      Owner: { player: 0 },
      Position: { x: fx.fromInt(1), y: fx.fromInt(1) },
    },
  }));
  const snapshot = snapshotOf([
    ...units.map((unit, i) => ({
      id: unit.ref,
      components: {
        Settler: { jobType: posted ? 1 : 31 },
        Owner: { player: 0 },
        ...(commanded && i === 0 ? { Rider: { vehicle: 100000, boarding: true, leaving: null } } : {}),
        ...(posted ? { JobAssignment: { workplace: 9000 } } : {}),
        Position: { x: fx.fromInt(1 + (i % 40)), y: fx.fromInt(1 + Math.floor(i / 40)) },
      },
    })),
    ...vehicles,
  ]);
  const selected = new Set([...units.map((unit) => unit.ref), ...vehicles.map((vehicle) => vehicle.id)]);
  const issued: PlayerCommand[] = [];
  const limited: number[] = [];
  const marked: unknown[] = [];
  const cues: string[] = [];
  const content = sandboxContent();
  const targets = withPointHits({
    owned: (kind) => (house && kind === 'building' ? [{ ref: HOUSE, ...POINT, kind: 'building' }] : []),
    buildings: () => (house ? [{ ref: HOUSE, ...POINT, kind: 'building' }] : []),
    flags: () => [],
    signposts: () => [],
    chests: () => [],
    goods: () => [],
    resources: () => [],
    wildlife: () => [],
    claimableLivestock: () => [],
    enemies: () => (enemy ? [{ ref: ENEMY, ...POINT, kind: 'settler' }] : []),
    ownedSettlersIn: (ids) => units.filter((unit) => ids.has(unit.ref)),
  });
  const shared = {
    answered: createAnsweredOrders(),
    snapshot: () => snapshot,
    targets,
    content,
    mapSize: { width: 128, height: 128 },
    toWorld: (x: number, y: number) => ({ x, y }),
    enqueue: (command: PlayerCommand) => issued.push(command),
    onOrderLimit: () => {
      limited.push(1);
    },
    cue: (cue: string) => cues.push(cue),
  };
  const orderDeps = {
    ...shared,
    camera: STILL_CAMERA,
    markOrder: (node: unknown) => {
      marked.push(node);
    },
    selected: () => selected,
    selectOwnSettler: () => {},
    openActions: () => {},
    drivenVehicles: () => vehicleOrders.selectedOwnVehicles(),
  };
  const orders = createUnitOrderController(orderDeps);
  const vehicleDeps = { ...shared, selected: () => selected, viewer: fixedViewerSeat(0) };
  const vehicleOrders = createVehicleOrderController(vehicleDeps);
  const rightClick = (event: MouseEvent, onBuilding: number | null = null): boolean =>
    rightClickSettlers(orders, orderDeps, event, onBuilding);
  const driveClick = (event: MouseEvent): boolean => rightClickVehicles(vehicleOrders, vehicleDeps, event);
  const pickMode = createPickModeController({
    ...shared,
    nodeAt: () => TARGET,
    orders: () => orders,
    vehicleOrders: () => vehicleOrders,
    setArmedCursor: () => {},
  });
  const overview = createOverviewOrders({
    pickMode,
    orders: () => orders,
    vehicleOrders: () => ({ issueDriveTo: () => false, selectedOwnVehicles: () => [] }),
    workFlagBinding: () => DEFAULT_KEY_BINDINGS.workFlagOrder,
  });
  const ring = (id: Parameters<typeof issueRingCommand>[0]): boolean =>
    issueRingCommand(
      id,
      units.map((unit) => unit.ref),
      {
        pickMode,
        enqueue: shared.enqueue,
        onOrderLimit: shared.onOrderLimit,
        openEquipment: () => {},
        toggleWorkArea: () => {},
        siegeVehicles: vehicleOrders.selectedSiegeVehicles,
      },
    );
  return {
    issued,
    orders,
    rightClick,
    driveClick,
    vehicleOrders,
    pickMode,
    overview,
    ring,
    selected,
    limited,
    marked,
    cues,
  };
}

function click(button: number, shiftKey = false): MouseEvent {
  return { clientX: POINT.x, clientY: POINT.y, button, shiftKey } as MouseEvent;
}

function expectWholeArmy(command: PlayerCommand | undefined, kind: PlayerCommand['kind']): void {
  expect(command?.kind).toBe(kind);
  if (command === undefined || !('members' in command)) throw new Error('expected an army command');
  expect(command.members).toHaveLength(COUNT);
  expect(new Set(command.members.map((member) => member.entity)).size).toBe(COUNT);
  if (command.kind === 'moveUnitGroup' || command.kind === 'attackMoveUnitGroup') {
    expect(new Set(command.members.map((member) => `${member.x},${member.y}`)).size).toBe(COUNT);
  }
}

describe('army selection input', () => {
  it.each([false, true])(
    'submits 1000 soldiers and 25 siege vehicles in two right-click envelopes (enemy=%s)',
    (enemy) => {
      const h = harness(enemy, COUNT, false, 25);
      expect(h.rightClick(click(2))).toBe(true);
      expect(h.driveClick(click(2))).toBe(true);
      expect(h.issued.map((command) => command.kind)).toEqual(
        enemy ? ['attackUnitGroup', 'attackWithVehicleGroup'] : ['moveUnitGroup', 'moveVehicleGroup'],
      );
      const [army, vehicles] = h.issued;
      expect(army && 'members' in army ? army.members.length : 0).toBe(1000);
      expect(vehicles && 'members' in vehicles ? vehicles.members.length : 0).toBe(25);
    },
  );

  it('marches the whole mixed selection in two envelopes, a Shift press queuing both', () => {
    const h = harness(false, COUNT, false, 25);
    h.ring('attackPosition');
    expect(h.pickMode.handleMouseDown(click(0))).toBe('ordered');
    expect(h.issued.map((command) => command.kind)).toEqual(['attackMoveUnitGroup', 'moveVehicleGroup']);
    expect(h.issued[1]).toMatchObject({ attackMove: true });
    h.issued.length = 0;
    h.ring('attackPosition');
    expect(h.pickMode.handleMouseDown(click(0, true))).toBe('ordered');
    expect(h.issued).toMatchObject([
      { kind: 'attackMoveUnitGroup', queued: true },
      { kind: 'moveVehicleGroup', attackMove: true, queued: true },
    ]);
  });

  it('leaves a commander out of a Shift walk its selected vehicle takes itself', () => {
    const h = harness(false, 2, false, 1, true);
    expect(h.rightClick(click(2, true))).toBe(true);
    expect(h.driveClick(click(2, true))).toBe(true);
    const walk = h.issued[0];
    if (walk?.kind !== 'moveUnit') throw new Error('expected one walk');
    expect(walk).toMatchObject({ entity: 2, queued: true });
    expect(h.issued[1]).toMatchObject({ kind: 'moveVehicle', vehicle: 100000, queued: true });
  });

  it('refuses an oversized mixed march before either group emits', () => {
    const h = harness(false, MAX_UNIT_ORDER_MEMBERS - 24, false, 25);
    h.ring('attackPosition');
    expect(h.pickMode.handleMouseDown(click(0))).toBe('missed');
    expect(h.issued).toEqual([]);
    expect(h.limited).toEqual([1]);
  });

  it('keeps all 1000 release-and-flag pairs in one armed gesture', () => {
    const h = harness(false, COUNT, true);
    h.pickMode.arm({ kind: 'workplace-or-flag', units: [...h.selected] });
    expect(h.pickMode.handleMouseDown(click(0))).toBe('ordered');
    expect(h.issued).toEqual([
      {
        kind: 'unitOrdersGroup',
        members: [...h.selected].map((entity) => ({
          entity,
          actions: [{ kind: 'unassignWorker' }, { kind: 'setWorkFlag', x: TARGET.col, y: TARGET.row }],
        })),
      },
    ]);
  });

  it('refuses an oversized equipment opening without reporting a successful ring gesture', () => {
    const h = harness(false, MAX_UNIT_ORDER_MEMBERS + 1);
    expect(h.ring('changeEquipment')).toBe(false);
    expect(h.issued).toEqual([]);
    expect(h.limited).toEqual([1]);
  });

  it.each(['home', 'workplace'] as const)('refuses an oversized %s pick on a building whole', (kind) => {
    const h = harness(false, MAX_UNIT_ORDER_MEMBERS + 1, false, 0, false, true);
    h.pickMode.arm({ kind, units: [...h.selected] });
    expect(h.pickMode.handleMouseDown(click(0))).toBe('missed');
    expect(h.issued).toEqual([]);
    expect(h.limited).toEqual([1]);
  });

  it('refuses an oversized right-click on an own building before any group order', () => {
    const h = harness(false, MAX_UNIT_ORDER_MEMBERS + 1, false, 0, false, true);
    expect(h.rightClick(click(2), HOUSE)).toBe(false);
    expect(h.issued).toEqual([]);
    expect(h.limited).toEqual([1]);
    expect(h.cues).toEqual(['fail']);
  });

  it('refuses an oversized release-and-flag before releasing anyone', () => {
    const h = harness(false, MAX_UNIT_ORDER_MEMBERS + 1, true);
    h.pickMode.arm({ kind: 'workplace-or-flag', units: [...h.selected] });
    expect(h.pickMode.handleMouseDown(click(0))).toBe('missed');
    expect(h.issued).toEqual([]);
    expect(h.limited).toEqual([1]);
    expect(h.cues).toEqual(['fail']);
  });

  it.each(['world', 'overview'] as const)('sends one formation order for a 1000-unit %s click', (surface) => {
    const h = harness();
    if (surface === 'world') h.rightClick(click(2));
    else h.overview(POINT.x, POINT.y, click(2));
    expect(h.issued).toHaveLength(1);
    expectWholeArmy(h.issued[0], 'moveUnitGroup');
  });

  it.each(['world', 'overview'] as const)(
    'sends attack-move and intentional Shift waypoints from the %s',
    (surface) => {
      const h = harness();
      h.ring('attackPosition');
      if (surface === 'world') h.pickMode.handleMouseDown(click(0));
      else h.overview(POINT.x, POINT.y, click(0));
      h.ring('attackPosition');
      if (surface === 'world') h.pickMode.handleMouseDown(click(0, true));
      else h.overview(POINT.x, POINT.y, click(0, true));
      expect(h.issued).toHaveLength(2);
      expectWholeArmy(h.issued[0], 'attackMoveUnitGroup');
      expectWholeArmy(h.issued[1], 'attackMoveUnitGroup');
      expect(h.issued[0]).not.toHaveProperty('queued');
      expect(h.issued[1]).toHaveProperty('queued', true);
    },
  );

  it('keeps consecutive normal clicks as replacing group orders', () => {
    const h = harness();
    h.rightClick(click(2));
    h.orders.issueAttackMove({ col: 160, row: 80 });
    h.orders.issueMoveTo({ col: 170, row: 80 });
    expect(h.issued.map((order) => order.kind)).toEqual([
      'moveUnitGroup',
      'attackMoveUnitGroup',
      'moveUnitGroup',
    ]);
    for (const order of h.issued) expect(order).not.toHaveProperty('queued');
  });

  it.each(['right-click', 'armed'] as const)('sends one explicit target attack through %s', (input) => {
    const h = harness(true);
    if (input === 'right-click') h.rightClick(click(2));
    else {
      h.ring('attackInhabitants');
      h.pickMode.handleMouseDown(click(0));
    }
    expect(h.issued).toHaveLength(1);
    expectWholeArmy(h.issued[0], 'attackUnitGroup');
    expect(h.issued[0]).toHaveProperty('target', ENEMY);
  });

  it('sends one stance or regeneration action for all 1000 selected soldiers', () => {
    const h = harness();
    for (const action of [
      'attackMode',
      'defenceMode',
      'ignorantMode',
      'prohibitRegeneration',
      'allowRegeneration',
    ] as const) {
      h.ring(action);
    }
    expect(h.issued).toHaveLength(5);
    for (const order of h.issued) expectWholeArmy(order, order.kind);
  });

  it.each([
    ['eat', { kind: 'orderNeed', need: 'hunger' }],
    ['removeVehicle', { kind: 'detachFromVehicle' }],
    ['removeHome', { kind: 'unassignHouse' }],
    ['haveGirl', { kind: 'makeChild', child: 'female' }],
  ] as const)('submits the %s ring action once for all 1000 members', (id, action) => {
    const h = harness();
    expect(h.ring(id)).toBe(true);
    expect(h.issued).toHaveLength(1);
    expectWholeArmy(h.issued[0], 'unitActionGroup');
    expect(h.issued[0]).toHaveProperty('action', action);
  });

  it('refuses an oversized gesture whole with feedback and no movement marker', () => {
    const h = harness(false, MAX_UNIT_ORDER_MEMBERS + 1);
    expect(h.orders.issueMoveTo(TARGET)).toBe(false);
    expect(h.orders.issueAttackMove(TARGET)).toBe(false);
    expect(h.ring('defenceMode')).toBe(false);
    expect(h.ring('eat')).toBe(false);
    expect(h.ring('removeVehicle')).toBe(false);
    expect(h.issued).toEqual([]);
    expect(h.marked).toEqual([]);
    expect(h.limited).toHaveLength(5);
    expect(h.cues).toEqual(['fail', 'fail']);
  });

  it('never splits an oversized direct submission into partial commands', () => {
    const issued: PlayerCommand[] = [];
    const members = Array.from({ length: MAX_UNIT_ORDER_MEMBERS + 1 }, (_, i) => ({
      entity: (i + 1) as Entity,
      x: i,
      y: 0,
    }));
    expect(
      enqueueArmyOrder({ kind: 'moveUnitGroup', members, queued: true }, (order) => issued.push(order)),
    ).toBe(false);
    expect(issued).toEqual([]);
  });
});
