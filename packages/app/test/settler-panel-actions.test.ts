import type { UiCue } from '@open-northland/audio';
import type { PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { fixedViewerSeat, type ViewerSeat } from '../src/game/viewer-seat.js';
import type { ActionOrderId } from '../src/hud/action-ring/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import { createPickModeController } from '../src/view/unit-controls/pick-mode.js';
import { settlerPanelActions } from '../src/view/unit-controls/settler-panel.js';
import { NO_TARGETS } from './support/pick-mode.js';
import { snapshotOf } from './support/sandbox.js';

const OWN = 1;
const FOREIGN = 2;
const SEAT = 0;
const OTHER_SEAT = 3;
const GOOD = 40;

const SNAPSHOT = snapshotOf([
  { id: OWN, components: { Owner: { player: SEAT }, Settler: { tribe: 1, jobType: 8 } } },
  { id: FOREIGN, components: { Owner: { player: OTHER_SEAT }, Settler: { tribe: 1, jobType: 8 } } },
]);

function harness(viewer: ViewerSeat = fixedViewerSeat(SEAT)) {
  const sent: PlayerCommand[] = [];
  const cues: UiCue[] = [];
  const rings: [ActionOrderId, readonly number[]][] = [];
  const renamed: [number, string][] = [];
  const actions = settlerPanelActions(
    { snapshot: () => SNAPSHOT, viewer, enqueue: (command) => sent.push(command) },
    {
      selectEntity: () => undefined,
      selectGroup: () => undefined,
      centre: () => undefined,
      openOrders: () => undefined,
      assignWorkplace: () => undefined,
      assignHome: () => undefined,
      attachTradeHouse: () => undefined,
      pickPartner: () => undefined,
      ringCommand: (id, targets) => rings.push([id, targets]),
      cue: (cue) => cues.push(cue),
    },
    { rename: (id, name) => renamed.push([id, name]), setProductionCount: () => undefined },
    null,
  );
  return { actions, sent, cues, rings, renamed };
}

describe('the settler panel’s orders', () => {
  it('sends an order for the seat’s own settler and confirms the press', () => {
    const { actions, sent, cues } = harness();
    actions.onlyProduct(OWN, GOOD);
    expect(sent).toEqual([{ kind: 'setProductionGoods', entity: OWN, goods: [GOOD] }]);
    expect(cues).toEqual(['confirm']);
  });

  it('refuses another seat’s settler and a vanished one, sending nothing', () => {
    const { actions, sent, cues, renamed } = harness();
    actions.unassignWorkplace(FOREIGN);
    actions.rename(FOREIGN, 'Bjorn');
    expect(sent).toEqual([]);
    expect(renamed).toEqual([]);
    expect(cues).toEqual(['fail', 'fail']);
  });

  it('lets the whole-map view order everyone', () => {
    const { actions, sent } = harness({ seat: () => SEAT, wholeMap: () => true, version: () => 0 });
    actions.setStance(FOREIGN, 1);
    expect(sent).toEqual([{ kind: 'setStance', entity: FOREIGN, mode: 1 }]);
  });

  it('gives a need row the ring’s order, so the ring’s gate decides', () => {
    const { actions, rings } = harness();
    actions.orderNeed(OWN, 'piety');
    expect(rings).toEqual([['pray', [OWN]]]);
  });
});

describe('the partner pick', () => {
  const pickUnder = (under: number | null) => {
    const wed: [number, number][] = [];
    const pickMode = createPickModeController({
      snapshot: () => SNAPSHOT,
      targets: { ...NO_TARGETS, owned: () => (under === null ? [] : [{ ref: under, x: 0, y: 0 }]) },
      content: createSceneSim(sandboxScene).content,
      mapSize: { width: 8, height: 8 },
      toWorld: () => ({ x: 0, y: 0 }),
      nodeAt: () => ({ col: 0, row: 0 }),
      enqueue: () => undefined,
      orders: () => {
        throw new Error('no order controller in this test');
      },
      vehicleOrders: () => {
        throw new Error('no vehicle order controller in this test');
      },
      setArmedCursor: () => undefined,
      marry: (settler, partner) => wed.push([settler, partner]),
    });
    pickMode.arm({ kind: 'partner', settler: OWN });
    const press = pickMode.handleMouseDown({ clientX: 0, clientY: 0, button: 0 } as MouseEvent);
    return { press, wed };
  };

  it('weds the settler to the person under the press', () => {
    expect(pickUnder(FOREIGN)).toEqual({ press: 'ordered', wed: [[OWN, FOREIGN]] });
  });

  it('misses on empty ground and on the settler itself', () => {
    expect(pickUnder(null)).toEqual({ press: 'missed', wed: [] });
    expect(pickUnder(OWN)).toEqual({ press: 'missed', wed: [] });
  });
});
