import type { UiCue } from '@open-northland/audio';
import { halfCellToScreen } from '@open-northland/render';
import { type Command, fx, type WorldSnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { DEFAULT_KEY_BINDINGS } from '../src/hud/keybindings.js';
import { createUnitOrderController } from '../src/view/unit-controls/orders.js';
import { createOverviewOrders, type OverviewPress } from '../src/view/unit-controls/overview-orders.js';
import { createPickModeController, type PickModeController } from '../src/view/unit-controls/pick-mode.js';
import { createUnitSelection } from '../src/view/unit-controls/selection.js';
import type { UnitTargets } from '../src/view/unit-controls/unit-targets.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * Orders named on the map overview: the minimap hands over the world spot its pixel depicts, and that
 * spot must reach the sim as the same command a click on the world view would issue at that node.
 */

const SCOUT = { id: 1, col: 2, row: 4 };
const MAP_SIZE = { width: 16, height: 16 };
/** A far node the camera is nowhere near - the case the overview exists for. */
const FAR_NODE = { hx: 25, hy: 27 };

const WORLD: WorldSnapshot = snapshotOf([
  {
    id: SCOUT.id,
    components: {
      Settler: { jobType: null },
      Position: { x: fx.fromInt(SCOUT.col), y: fx.fromInt(SCOUT.row) },
    },
  } satisfies Ent,
]);

/** Nothing is pickable, so every press resolves to open ground. */
const targets: UnitTargets = {
  owned: () => [],
  enemies: () => [],
  flags: () => [],
  signposts: () => [],
  chests: () => [],
  resources: () => [],
  wildlife: () => [],
  ownedSettlersIn: (refs) =>
    refs.has(SCOUT.id) ? [{ ref: SCOUT.id, ...halfCellToScreen(SCOUT.col * 2, SCOUT.row * 2) }] : [],
};

/** A press on the overview pixel that depicts `node`; the overview plots the map flat. */
const pressOn = (
  press: OverviewPress,
  node: { hx: number; hy: number },
  event: Partial<MouseEvent> & { button: number },
): boolean => {
  const spot = halfCellToScreen(node.hx, node.hy);
  return press(spot.x, spot.y, event as MouseEvent);
};

function harness(workFlagBinding = DEFAULT_KEY_BINDINGS.workFlagOrder): {
  press: OverviewPress;
  pickMode: PickModeController;
  issued: Command[];
  cues: UiCue[];
  selection: ReturnType<typeof createUnitSelection>;
} {
  const issued: Command[] = [];
  const cues: UiCue[] = [];
  const selection = createUnitSelection();
  selection.apply([SCOUT.id], false);
  const orders = createUnitOrderController({
    selected: selection.ids,
    targets,
    snapshot: () => WORLD,
    content: sandboxContent(),
    mapSize: MAP_SIZE,
    toWorld: (clientX, clientY) => ({ x: clientX, y: clientY }),
    enqueue: (command) => issued.push(command),
    selectOwnSettler: () => {},
    openActions: () => {},
  });
  const pickMode = createPickModeController({
    snapshot: () => WORLD,
    targets,
    content: sandboxContent(),
    mapSize: MAP_SIZE,
    toWorld: (clientX, clientY) => ({ x: clientX, y: clientY }),
    nodeAt: () => ({ col: 0, row: 0 }),
    enqueue: (command) => issued.push(command),
    orders: () => orders,
    setArmedCursor: () => {},
  });
  const press = createOverviewOrders({
    pickMode,
    orders: () => orders,
    workFlagBinding: () => workFlagBinding,
    cue: (cue) => {
      cues.push(cue);
    },
  });
  return { press, pickMode, issued, cues, selection };
}

describe('orders named on the map overview', () => {
  it('walks the selection to the node the pressed overview spot depicts', () => {
    const { press, issued } = harness();

    expect(pressOn(press, FAR_NODE, { button: 2 })).toBe(true);

    expect(issued).toEqual([{ kind: 'moveUnit', entity: SCOUT.id, x: FAR_NODE.hx, y: FAR_NODE.hy }]);
  });

  it('plants a work flag there on the same modifier the world view uses', () => {
    const { press, issued } = harness();

    pressOn(press, FAR_NODE, { button: 2, ctrlKey: true });

    expect(issued).toEqual([{ kind: 'setWorkFlag', entity: SCOUT.id, x: FAR_NODE.hx, y: FAR_NODE.hy }]);
  });

  it('keeps Cmd as the macOS form of the default work-flag binding', () => {
    const { press, issued } = harness();

    pressOn(press, FAR_NODE, { button: 2, metaKey: true });

    expect(issued).toEqual([{ kind: 'setWorkFlag', entity: SCOUT.id, x: FAR_NODE.hx, y: FAR_NODE.hy }]);
  });

  it('uses the rebound mouse chord for a work flag', () => {
    const { press, issued } = harness('Shift+Mouse0');

    expect(pressOn(press, FAR_NODE, { button: 0, shiftKey: true })).toBe(true);
    expect(issued).toEqual([{ kind: 'setWorkFlag', entity: SCOUT.id, x: FAR_NODE.hx, y: FAR_NODE.hy }]);
  });

  it('resolves an armed attack-move without scrolling the view to the target', () => {
    const { press, pickMode, issued } = harness();
    pickMode.arm({ kind: 'attack-move' });

    expect(pressOn(press, FAR_NODE, { button: 0 })).toBe(true);

    expect(issued).toEqual([{ kind: 'attackMoveUnit', entity: SCOUT.id, x: FAR_NODE.hx, y: FAR_NODE.hy }]);
    expect(pickMode.isArmed()).toBe(false);
  });

  it('leaves a mode that needs a picked building armed, so the press only scrolls the view', () => {
    const { press, pickMode, issued } = harness();
    pickMode.arm({ kind: 'workplace', settler: SCOUT.id });

    expect(pressOn(press, FAR_NODE, { button: 0 })).toBe(false);

    expect(issued).toEqual([]);
    expect(pickMode.isArmed()).toBe(true);
  });

  it('calls an armed mode off on the right button instead of ordering a walk', () => {
    const { press, pickMode, issued } = harness();
    pickMode.arm({ kind: 'attack-move' });

    expect(pressOn(press, FAR_NODE, { button: 2 })).toBe(true);

    expect(issued).toEqual([]);
    expect(pickMode.isArmed()).toBe(false);
  });

  it('clicks confirm for an order that commanded someone, fail for a called-off pick, nothing otherwise', () => {
    const { press, pickMode, cues, selection } = harness();

    pressOn(press, FAR_NODE, { button: 2 }); // the scout walks
    expect(cues).toEqual(['confirm']);

    pickMode.arm({ kind: 'attack-move' });
    pressOn(press, FAR_NODE, { button: 0 }); // resolves the armed spot pick
    expect(cues).toEqual(['confirm', 'confirm']);

    pickMode.arm({ kind: 'attack-move' });
    pressOn(press, FAR_NODE, { button: 2 }); // called off
    expect(cues).toEqual(['confirm', 'confirm', 'fail']);

    pickMode.arm({ kind: 'workplace', settler: SCOUT.id });
    pressOn(press, FAR_NODE, { button: 0 }); // stays armed: the press only scrolls the view
    expect(cues).toHaveLength(3);
    pickMode.cancel();

    selection.apply([], false);
    expect(pressOn(press, FAR_NODE, { button: 2 })).toBe(true); // the overview keeps the press...
    expect(cues).toHaveLength(3); // ...but nobody walked, so nothing clicks
  });
});

describe('a world press on an armed pick mode', () => {
  const click = (button: number): MouseEvent => ({ clientX: 10, clientY: 10, button }) as MouseEvent;

  it('reports an order, a miss, or a call-off, and nothing when no mode is armed', () => {
    const { pickMode, issued } = harness();
    expect(pickMode.handleMouseDown(click(0))).toBeNull();

    pickMode.arm({ kind: 'attack-move' });
    expect(pickMode.handleMouseDown(click(0))).toBe('ordered');
    expect(issued).toHaveLength(1);

    pickMode.arm({ kind: 'workplace', settler: SCOUT.id });
    expect(pickMode.handleMouseDown(click(0))).toBe('missed'); // no building under the press
    expect(pickMode.isArmed()).toBe(false);

    pickMode.arm({ kind: 'attack-move' });
    expect(pickMode.handleMouseDown(click(2))).toBe('calledOff');
    expect(issued).toHaveLength(1);
  });
});
