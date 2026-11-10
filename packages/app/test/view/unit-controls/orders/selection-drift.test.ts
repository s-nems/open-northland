import { halfCellToScreen, type OrderMarkerKind } from '@open-northland/render';
import { type Command, fx, nodeOfPosition, systems, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR } from '../../../../src/catalog/jobs.js';
import { sandboxContent } from '../../../../src/game/sandbox/index.js';
import type { Tile } from '../../../../src/view/picking.js';
import { createAnsweredOrders } from '../../../../src/view/unit-controls/orders/answered.js';
import {
  createUnitOrderController,
  type UnitOrderController,
  type UnitOrderDeps,
} from '../../../../src/view/unit-controls/orders/controller.js';
import { createUnitSelection, type UnitSelection } from '../../../../src/view/unit-controls/selection.js';
import type { UnitTargets } from '../../../../src/view/unit-controls/unit-targets.js';
import { withPointHits } from '../../../support/point-hits.js';
import { rightClickSettlers, rightClickWorkFlag } from '../../../support/right-click.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';
import { STILL_CAMERA } from '../../../support/still-camera.js';

/**
 * Every order resolves who is selected when the click lands: the controller is driven by the real
 * selection unit here, so it may not hold an answer taken when it was built.
 */

/** Whole-tile cell coordinates, the space a `Position` is written in; `nodeUnder` converts to nodes. */
interface TileCell {
  readonly col: number;
  readonly row: number;
}

interface Unit {
  readonly id: number;
  readonly cell: TileCell;
}

const SCOUT: Unit = { id: 1, cell: { col: 2, row: 4 } };
const GUARD: Unit = { id: 2, cell: { col: 6, row: 4 } };
const UNITS: readonly Unit[] = [SCOUT, GUARD];

const MAP_SIZE = { width: 16, height: 16 };

const nodeUnder = (cell: TileCell): { hx: number; hy: number } =>
  nodeOfPosition(fx.fromInt(cell.col), fx.fromInt(cell.row));

/** Open ground inside the node bounds that no unit stands on. */
const OPEN_GROUND = { hx: 20, hy: 20 };

const standing = (unit: Unit): Ent => ({
  id: unit.id,
  components: {
    Settler: { jobType: null },
    Position: { x: fx.fromInt(unit.cell.col), y: fx.fromInt(unit.cell.row) },
  },
});

const WORLD: WorldSnapshot = snapshotOf(UNITS.map(standing));
const CONTENT = sandboxContent();

/** `toWorld` below is the identity, so a click carries the world point it lands on. */
const clickOn = (node: { hx: number; hy: number }): MouseEvent => {
  const p = halfCellToScreen(node.hx, node.hy);
  return { clientX: p.x, clientY: p.y } as MouseEvent;
};

/** The same node as the ground orders name it. */
const nodeTile = (node: { hx: number; hy: number }): Tile => ({ col: node.hx, row: node.hy });

/** Nothing is pickable under the cursor, so every click resolves to open ground. */
const targets: UnitTargets = {
  owned: () => [],
  buildings: () => [],
  enemies: () => [],
  flags: () => [],
  signposts: () => [],
  chests: () => [],
  goods: () => [],
  resources: () => [],
  wildlife: () => [],
  claimableLivestock: () => [],
  ownedSettlersIn: (refs) =>
    UNITS.filter((u) => refs.has(u.id)).map((u) => {
      const node = nodeUnder(u.cell);
      return { ref: u.id, ...halfCellToScreen(node.hx, node.hy) };
    }),
};

function harness(
  initiallySelected: readonly number[] = [],
  overrides: Partial<UnitTargets> = {},
  world: WorldSnapshot = WORLD,
): {
  selection: UnitSelection;
  orders: UnitOrderController;
  rightClick: (event: MouseEvent) => boolean;
  workFlagClick: (event: MouseEvent) => boolean;
  issued: Command[];
  marked: [Tile, OrderMarkerKind][];
} {
  const issued: Command[] = [];
  const marked: [Tile, OrderMarkerKind][] = [];
  const selection = createUnitSelection(() => true);
  selection.apply(initiallySelected, false);
  const deps = {
    answered: createAnsweredOrders(),
    camera: STILL_CAMERA,
    selected: selection.ids,
    targets: withPointHits({ ...targets, ...overrides }),
    snapshot: () => world,
    content: CONTENT,
    mapSize: MAP_SIZE,
    toWorld: (clientX, clientY) => ({ x: clientX, y: clientY }),
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
    markOrder: (node, kind) => marked.push([node, kind]),
  } satisfies UnitOrderDeps;
  const orders = createUnitOrderController(deps);
  return {
    selection,
    orders,
    rightClick: (event) => rightClickSettlers(orders, deps, event),
    workFlagClick: (event) => rightClickWorkFlag(orders, deps, event),
    issued,
    marked,
  };
}

describe('unit orders against a selection that moves under them', () => {
  it('sends the units selected now on a move order, not the ones selected at construction', () => {
    const { selection, rightClick, issued } = harness();

    selection.apply([SCOUT.id], false);
    expect(rightClick(clickOn(OPEN_GROUND))).toBe(true); // an order: the click confirms
    expect(issued).toEqual([{ kind: 'moveUnit', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy }]);

    issued.length = 0;
    selection.apply([GUARD.id], false);
    rightClick(clickOn(OPEN_GROUND));
    expect(issued).toEqual([{ kind: 'moveUnit', entity: GUARD.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy }]);
  });

  it("queues a Shift + right-click walk behind each settler's current order", () => {
    const { rightClick, issued } = harness([SCOUT.id]);

    rightClick({ ...clickOn(OPEN_GROUND), shiftKey: true } as MouseEvent);
    expect(issued).toEqual([
      { kind: 'moveUnit', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy, queued: true },
    ]);
  });

  it("queues the strike at an enemy under a Shift + right-click behind each settler's current order", () => {
    const ENEMY = 50;
    const { rightClick, issued } = harness([SCOUT.id], {
      enemies: () => {
        const p = halfCellToScreen(OPEN_GROUND.hx, OPEN_GROUND.hy);
        return [{ ref: ENEMY, x: p.x, y: p.y, kind: 'settler' }];
      },
    });

    rightClick({ ...clickOn(OPEN_GROUND), shiftKey: true } as MouseEvent);
    expect(issued).toEqual([{ kind: 'attackUnit', entity: SCOUT.id, target: ENEMY, queued: true }]);
  });

  it('queues a walk to an own building under a Shift + right-click, a post or home being no queued order', () => {
    const HOUSE = 60;
    const { rightClick, issued } = harness([SCOUT.id], {
      owned: (kind) => {
        const p = halfCellToScreen(OPEN_GROUND.hx, OPEN_GROUND.hy);
        return kind === 'building' ? [{ ref: HOUSE, x: p.x, y: p.y, kind: 'building' }] : [];
      },
    });

    rightClick({ ...clickOn(OPEN_GROUND), shiftKey: true } as MouseEvent);
    expect(issued).toEqual([
      { kind: 'moveUnit', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy, queued: true },
    ]);
  });

  it('marks the clicked spot once per walk or march, red for the march, and nothing when nobody went', () => {
    const { selection, orders, rightClick, marked } = harness([SCOUT.id, GUARD.id]);
    const ground: Tile = { col: OPEN_GROUND.hx, row: OPEN_GROUND.hy };

    rightClick(clickOn(OPEN_GROUND));
    orders.issueAttackMove(ground);
    expect(marked).toEqual([
      [ground, 'move'],
      [ground, 'attack'],
    ]);

    marked.length = 0;
    selection.apply([], false);
    orders.issueMoveTo(ground);
    expect(marked).toEqual([]);
  });

  it('drops a right-click once the selection has been cleared', () => {
    const { selection, rightClick, issued } = harness([SCOUT.id]);

    selection.apply([], false);
    expect(rightClick(clickOn(OPEN_GROUND))).toBe(false); // nobody to command: no click either

    expect(issued).toEqual([]);
  });

  it('reports no order for a selection with no settler in it (a building or flag)', () => {
    const BUILDING_ID = 77;
    const { selection, orders, rightClick, issued } = harness();

    const ground: Tile = { col: OPEN_GROUND.hx, row: OPEN_GROUND.hy };
    selection.apply([BUILDING_ID], false);
    expect(rightClick(clickOn(OPEN_GROUND))).toBe(false);
    expect(orders.issueMoveTo(ground)).toBe(false);
    expect(orders.issueSetWorkFlag(ground)).toBe(false);
    expect(issued).toEqual([]);

    selection.apply([SCOUT.id], false);
    expect(orders.issueMoveTo(ground)).toBe(true);
    expect(issued).toHaveLength(1);
  });

  it('frees the ground the current selection stands on when it attack-moves', () => {
    const { selection, orders, issued } = harness();
    const under = nodeUnder(SCOUT.cell);

    // Onto its own node: the mover is excluded from the blocked ground, so the formation seats it there
    // rather than pushing it onto a neighbouring node.
    selection.apply([SCOUT.id], false);
    orders.issueAttackMove(nodeTile(under));

    expect(issued).toEqual([{ kind: 'attackMoveUnit', entity: SCOUT.id, x: under.hx, y: under.hy }]);
  });

  it('keeps the ground of a selected unit the armed order skips', () => {
    const { selection, orders, issued } = harness();
    const guarded = nodeUnder(GUARD.cell);

    // An attack-move armed for the scout alone, aimed at the node the still-selected guard stands on.
    selection.apply([SCOUT.id, GUARD.id], false);
    expect(orders.issueAttackMove(nodeTile(guarded), [SCOUT.id])).toBe(true);

    expect(issued).toHaveLength(1);
    const [order] = issued;
    expect(order).toMatchObject({ kind: 'attackMoveUnit', entity: SCOUT.id });
    expect(order).not.toMatchObject({ x: guarded.hx, y: guarded.hy });
  });

  it('strikes a neutral palisade from the action-ring attack mode and walks beside it on a right-click', () => {
    const target = { id: 50, at: OPEN_GROUND };
    const p = halfCellToScreen(target.at.hx, target.at.hy);
    const { orders, rightClick, issued } = harness([SCOUT.id], {
      // An unowned wall, which the targets offer only to an explicit attack pick.
      enemies: (opts) =>
        opts?.neutralWalls === true ? [{ ref: target.id, x: p.x, y: p.y, kind: 'palisade' }] : [],
    });

    expect(orders.issueAttackTarget(clickOn(target.at), ['building', 'palisade'])).toBe(true);
    expect(issued).toEqual([{ kind: 'attackUnit', entity: SCOUT.id, target: target.id }]);

    issued.length = 0;
    expect(rightClick(clickOn(target.at))).toBe(true);
    expect(issued).toEqual([{ kind: 'moveUnit', entity: SCOUT.id, x: target.at.hx, y: target.at.hy }]);
  });

  it('strikes an enemy vehicle from the action-ring attack mode, queued under Shift', () => {
    const target = { id: 51, at: OPEN_GROUND };
    const p = halfCellToScreen(target.at.hx, target.at.hy);
    const { orders, issued } = harness([SCOUT.id], {
      enemies: () => [{ ref: target.id, x: p.x, y: p.y, kind: 'vehicle' }],
    });

    expect(orders.issueAttackTarget(clickOn(target.at), 'vehicle', undefined, true)).toBe(true);
    expect(issued).toEqual([{ kind: 'attackUnit', entity: SCOUT.id, target: target.id, queued: true }]);
    issued.length = 0;
    expect(orders.issueAttackTarget(clickOn(target.at), 'settler')).toBe(false);
    expect(issued).toEqual([]);
  });

  it('plants a work flag for the units selected now', () => {
    const { selection, orders, issued } = harness();

    selection.apply([SCOUT.id], false);
    orders.issueSetWorkFlag(nodeTile(OPEN_GROUND));
    selection.apply([SCOUT.id, GUARD.id], true);
    orders.issueSetWorkFlag(nodeTile(OPEN_GROUND));

    expect(issued).toEqual([
      { kind: 'setWorkFlag', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
      {
        kind: 'unitActionGroup',
        members: [{ entity: SCOUT.id }, { entity: GUARD.id }],
        action: { kind: 'setWorkFlag', x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
      },
    ]);
  });

  it('switches a collector to the good of a right-clicked resource without moving its flag', () => {
    const [goodType] = systems.jobGatherGoods({ content: CONTENT }, JOB_COLLECTOR);
    if (goodType === undefined) throw new Error('setup: the collector gathers nothing');
    const resource = { id: 50, at: OPEN_GROUND };
    const p = halfCellToScreen(resource.at.hx, resource.at.hy);
    const snapshot = snapshotOf([
      ...UNITS.map((unit) =>
        unit === SCOUT
          ? {
              ...standing(unit),
              components: { ...standing(unit).components, Settler: { jobType: JOB_COLLECTOR } },
            }
          : standing(unit),
      ),
      { id: resource.id, components: { Resource: { goodType } } },
    ]);
    const { rightClick, issued } = harness(
      [SCOUT.id, GUARD.id],
      { resources: () => [{ ref: resource.id, x: p.x, y: p.y, kind: 'resource', goodType }] },
      snapshot,
    );

    expect(rightClick(clickOn(resource.at))).toBe(true);

    // The collector keeps its flag; the settler who gathers nothing walks there as before.
    expect(issued).toEqual([
      { kind: 'setGatherGood', entity: SCOUT.id, goodType },
      { kind: 'moveUnit', entity: GUARD.id, x: resource.at.hx, y: resource.at.hy },
    ]);

    // A gathered good is a standing setting: with Shift everyone walks there queued instead.
    issued.length = 0;
    expect(rightClick({ ...clickOn(resource.at), shiftKey: true } as MouseEvent)).toBe(true);
    expect(issued.map((command) => command.kind)).toEqual(['moveUnitGroup']);
    expect(issued[0]).toHaveProperty('queued', true);
  });

  it('moves the work flag and changes the gatherer filter on Ctrl+right-click over a resource', () => {
    const RESOURCE = 50;
    /** Any good: the sim, not the click, validates it against the settler's trade. */
    const RESOURCE_GOOD = 5;
    const p = halfCellToScreen(OPEN_GROUND.hx, OPEN_GROUND.hy);
    // The rendered target is the click's source of truth, even past the snapshot it was drawn from.
    const { workFlagClick, issued } = harness([SCOUT.id], {
      resources: () => [{ ref: RESOURCE, x: p.x, y: p.y, kind: 'resource', goodType: RESOURCE_GOOD }],
    });

    workFlagClick(clickOn(OPEN_GROUND));

    expect(issued).toEqual([
      {
        kind: 'unitOrdersGroup',
        members: [
          {
            entity: SCOUT.id,
            actions: [
              { kind: 'setWorkFlag', x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
              { kind: 'setGatherGood', goodType: RESOURCE_GOOD },
            ],
          },
        ],
      },
    ]);
  });
});
