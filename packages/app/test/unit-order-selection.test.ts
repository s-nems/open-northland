import { halfCellToScreen } from '@open-northland/render';
import { type Command, fx, nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_COLLECTOR } from '../src/catalog/jobs.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import type { Tile } from '../src/view/picking.js';
import { createUnitOrderController, type UnitOrderController } from '../src/view/unit-controls/orders.js';
import { createUnitSelection, type UnitSelection } from '../src/view/unit-controls/selection.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

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
  ownedSettlersIn: (refs) =>
    UNITS.filter((u) => refs.has(u.id)).map((u) => {
      const node = nodeUnder(u.cell);
      return { ref: u.id, ...halfCellToScreen(node.hx, node.hy) };
    }),
};

function harness(initiallySelected: readonly number[] = []): {
  selection: UnitSelection;
  orders: UnitOrderController;
  issued: Command[];
} {
  const issued: Command[] = [];
  const selection = createUnitSelection();
  selection.apply(initiallySelected, false);
  const orders = createUnitOrderController({
    selected: selection.ids,
    targets,
    snapshot: () => WORLD,
    content: CONTENT,
    mapSize: MAP_SIZE,
    toWorld: (clientX, clientY) => ({ x: clientX, y: clientY }),
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
  });
  return { selection, orders, issued };
}

describe('unit orders against a selection that moves under them', () => {
  it('sends the units selected now on a move order, not the ones selected at construction', () => {
    const { selection, orders, issued } = harness();

    selection.apply([SCOUT.id], false);
    expect(orders.issueRightClick(clickOn(OPEN_GROUND))).toBe(true); // an order: the click confirms
    expect(issued).toEqual([{ kind: 'moveUnit', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy }]);

    issued.length = 0;
    selection.apply([GUARD.id], false);
    orders.issueRightClick(clickOn(OPEN_GROUND));
    expect(issued).toEqual([{ kind: 'moveUnit', entity: GUARD.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy }]);
  });

  it('drops a right-click once the selection has been cleared', () => {
    const { selection, orders, issued } = harness([SCOUT.id]);

    selection.apply([], false);
    expect(orders.issueRightClick(clickOn(OPEN_GROUND))).toBe(false); // nobody to command: no click either

    expect(issued).toEqual([]);
  });

  it('reports no order for a selection with no settler in it (a building or flag)', () => {
    const BUILDING_ID = 77;
    const { selection, orders, issued } = harness();

    const ground: Tile = { col: OPEN_GROUND.hx, row: OPEN_GROUND.hy };
    selection.apply([BUILDING_ID], false);
    expect(orders.issueRightClick(clickOn(OPEN_GROUND))).toBe(false);
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
    const issued: Command[] = [];
    const target = { id: 50, at: OPEN_GROUND };
    const p = halfCellToScreen(target.at.hx, target.at.hy);
    const orders = createUnitOrderController({
      selected: () => new Set([SCOUT.id]),
      targets: {
        ...targets,
        // An unowned wall, which the targets offer only to an explicit attack pick.
        enemies: (opts) =>
          opts?.neutralWalls === true ? [{ ref: target.id, x: p.x, y: p.y, kind: 'palisade' }] : [],
      },
      snapshot: () => WORLD,
      content: CONTENT,
      mapSize: MAP_SIZE,
      toWorld: (clientX, clientY) => ({ x: clientX, y: clientY }),
      enqueue: (command) => issued.push(command),
      selectOwnSettler: () => {},
      openActions: () => {},
    });

    expect(orders.issueAttackTarget(clickOn(target.at), ['building', 'palisade'])).toBe(true);
    expect(issued).toEqual([{ kind: 'attackUnit', entity: SCOUT.id, target: target.id }]);

    issued.length = 0;
    expect(orders.issueRightClick(clickOn(target.at))).toBe(true);
    expect(issued).toEqual([{ kind: 'moveUnit', entity: SCOUT.id, x: target.at.hx, y: target.at.hy }]);
  });

  it('plants a work flag for the units selected now', () => {
    const { selection, orders, issued } = harness();

    selection.apply([SCOUT.id], false);
    orders.issueSetWorkFlag(nodeTile(OPEN_GROUND));
    selection.apply([SCOUT.id, GUARD.id], true);
    orders.issueSetWorkFlag(nodeTile(OPEN_GROUND));

    expect(issued).toEqual([
      { kind: 'setWorkFlag', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
      { kind: 'setWorkFlag', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
      { kind: 'setWorkFlag', entity: GUARD.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
    ]);
  });

  it('keeps plain right-click on a resource as an ordinary move order', () => {
    const issued: Command[] = [];
    const resource = { id: 50, goodType: 3, at: OPEN_GROUND };
    const p = halfCellToScreen(resource.at.hx, resource.at.hy);
    const resourceTargets: UnitTargets = {
      ...targets,
      resources: () => [{ ref: resource.id, x: p.x, y: p.y, kind: 'resource' }],
    };
    const snapshot = snapshotOf([
      ...UNITS.map((unit) =>
        unit === SCOUT
          ? {
              ...standing(unit),
              components: { ...standing(unit).components, Settler: { jobType: JOB_COLLECTOR } },
            }
          : standing(unit),
      ),
      { id: resource.id, components: { Resource: { goodType: resource.goodType } } },
    ]);
    const orders = createUnitOrderController({
      selected: () => new Set([SCOUT.id]),
      targets: resourceTargets,
      snapshot: () => snapshot,
      content: CONTENT,
      mapSize: MAP_SIZE,
      toWorld: (clientX, clientY) => ({ x: clientX, y: clientY }),
      enqueue: (command) => issued.push(command),
      selectOwnSettler: () => {},
      openActions: () => {},
    });

    orders.issueRightClick(clickOn(resource.at));

    expect(issued).toEqual([{ kind: 'moveUnit', entity: SCOUT.id, x: resource.at.hx, y: resource.at.hy }]);
  });

  it('moves the work flag and changes the gatherer filter on Ctrl+right-click over a resource', () => {
    const issued: Command[] = [];
    const p = halfCellToScreen(OPEN_GROUND.hx, OPEN_GROUND.hy);
    // The rendered target is the click's source of truth. It may outlive the snapshot that produced the
    // current controls frame; the sim validates the selected settler and good when applying the command.
    const snapshot = snapshotOf(UNITS.map(standing));
    const orders = createUnitOrderController({
      selected: () => new Set([SCOUT.id]),
      targets: {
        ...targets,
        resources: () => [{ ref: 50, x: p.x, y: p.y, kind: 'resource', goodType: 5 }],
      },
      snapshot: () => snapshot,
      content: CONTENT,
      mapSize: MAP_SIZE,
      toWorld: (clientX, clientY) => ({ x: clientX, y: clientY }),
      enqueue: (command) => issued.push(command),
      selectOwnSettler: () => {},
      openActions: () => {},
    });

    orders.issueSetWorkFlagAt(clickOn(OPEN_GROUND));

    expect(issued).toEqual([
      { kind: 'setWorkFlag', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
      { kind: 'setGatherGood', entity: SCOUT.id, goodType: 5 },
    ]);
  });
});
