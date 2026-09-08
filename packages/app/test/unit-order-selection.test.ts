import { halfCellToScreen } from '@open-northland/render';
import { type Command, fx, nodeOfPosition, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
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

/** Nothing is pickable under the cursor, so every click resolves to open ground. */
const targets: UnitTargets = {
  owned: () => [],
  enemies: () => [],
  flags: () => [],
  signposts: () => [],
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
    orders.issueRightClick(clickOn(OPEN_GROUND));
    expect(issued).toEqual([{ kind: 'moveUnit', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy }]);

    issued.length = 0;
    selection.apply([GUARD.id], false);
    orders.issueRightClick(clickOn(OPEN_GROUND));
    expect(issued).toEqual([{ kind: 'moveUnit', entity: GUARD.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy }]);
  });

  it('drops a right-click once the selection has been cleared', () => {
    const { selection, orders, issued } = harness([SCOUT.id]);

    selection.apply([], false);
    orders.issueRightClick(clickOn(OPEN_GROUND));

    expect(issued).toEqual([]);
  });

  it('frees the ground the current selection stands on when it attack-moves', () => {
    const { selection, orders, issued } = harness();
    const under = nodeUnder(SCOUT.cell);

    // Onto its own node: the mover is excluded from the blocked ground, so the formation seats it there
    // rather than pushing it onto a neighbouring node.
    selection.apply([SCOUT.id], false);
    orders.issueAttackMove(clickOn(under));

    expect(issued).toEqual([{ kind: 'attackMoveUnit', entity: SCOUT.id, x: under.hx, y: under.hy }]);
  });

  it('plants a work flag for the units selected now', () => {
    const { selection, orders, issued } = harness();

    selection.apply([SCOUT.id], false);
    orders.issueSetWorkFlag(clickOn(OPEN_GROUND));
    selection.apply([SCOUT.id, GUARD.id], true);
    orders.issueSetWorkFlag(clickOn(OPEN_GROUND));

    expect(issued).toEqual([
      { kind: 'setWorkFlag', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
      { kind: 'setWorkFlag', entity: SCOUT.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
      { kind: 'setWorkFlag', entity: GUARD.id, x: OPEN_GROUND.hx, y: OPEN_GROUND.hy },
    ]);
  });
});
