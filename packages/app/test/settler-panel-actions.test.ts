import type { UiCue } from '@open-northland/audio';
import type { PlayerCommand } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { fixedViewerSeat, type ViewerSeat } from '../src/game/viewer-seat.js';
import type { ActionOrderId } from '../src/hud/action-ring/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import { orderRecipients } from '../src/view/unit-controls/action-ring/menu-state.js';
import type { PickMode, PickModeController } from '../src/view/unit-controls/pick-mode.js';
import { issueRingCommand } from '../src/view/unit-controls/ring-commands.js';
import { settlerPanelActions } from '../src/view/unit-controls/settler-panel.js';
import { snapshotOf } from './support/sandbox.js';

const OWN = 1;
const FOREIGN = 2;
const SEAT = 0;
const OTHER_SEAT = 3;
const GOOD = 40;
const RIDER = 4;
const CART = 5;
const HOUSE_A = 6;
const HOUSE_B = 7;

const SNAPSHOT = snapshotOf([
  { id: OWN, components: { Owner: { player: SEAT }, Settler: { tribe: 1, jobType: 8 } } },
  { id: FOREIGN, components: { Owner: { player: OTHER_SEAT }, Settler: { tribe: 1, jobType: 8 } } },
  {
    id: RIDER,
    components: { Owner: { player: SEAT }, Settler: { tribe: 1, jobType: 8 }, Rider: { vehicle: CART } },
  },
]);

function harness(
  viewer: ViewerSeat = fixedViewerSeat(SEAT),
  ringCommand?: (id: ActionOrderId, targets: readonly number[]) => void,
) {
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
      closeOrders: () => undefined,
      assignWorkplace: () => undefined,
      assignHome: () => undefined,
      attachTradeHouse: () => undefined,
      ringCommand: ringCommand ?? ((id, targets) => rings.push([id, targets])),
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

  it('ends a builder’s road or wall run by unpinning it', () => {
    const { actions, sent } = harness();
    actions.endBuildRun(OWN);
    expect(sent).toEqual([{ kind: 'unassignBuilder', entity: OWN }]);
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

describe('the Handel section', () => {
  it('sends a press’s mark changes in order under one confirm, and the limits of a mark', () => {
    const { actions, sent, cues } = harness();
    actions.setTradeMarks(OWN, [
      { house: HOUSE_A, goodType: GOOD, on: false },
      { house: HOUSE_B, goodType: GOOD, on: true },
    ]);
    actions.setTradeImportLimits(OWN, HOUSE_B, GOOD, 10, 0);
    expect(sent).toEqual([
      { kind: 'setTradeImport', entity: OWN, house: HOUSE_A, good: GOOD, on: false },
      { kind: 'setTradeImport', entity: OWN, house: HOUSE_B, good: GOOD, on: true },
      { kind: 'setTradeImportLimits', entity: OWN, house: HOUSE_B, good: GOOD, upTo: 10, keep: 0 },
    ]);
    expect(cues).toEqual(['confirm', 'confirm']);
  });
});

describe('the Pojazd row', () => {
  it('gives its pick and its way off the ring’s own orders', () => {
    const { actions, rings } = harness();
    actions.assignVehicle(OWN);
    actions.leaveVehicle(RIDER);
    expect(rings).toEqual([
      ['assignVehicle', [OWN]],
      ['removeVehicle', [RIDER]],
    ]);
  });

  it('arms the ring’s vehicle pick and detaches a rider through the ring’s dispatch', () => {
    const armed: PickMode[] = [];
    const sent: PlayerCommand[] = [];
    const pickMode: PickModeController = {
      arm: (mode) => {
        armed.push(mode);
      },
      cancel: () => undefined,
      isArmed: () => armed.length > 0,
      armed: () => armed.at(-1) ?? null,
      signpostActive: () => false,
      dockVehicle: () => null,
      flagActive: () => false,
      handleMouseDown: () => null,
      handleOverviewPress: () => null,
      endShiftChain: () => {},
      highlight: () => null,
    };
    const content = createSceneSim(sandboxScene).content;
    const { actions } = harness(fixedViewerSeat(SEAT), (id, targets) =>
      issueRingCommand(id, orderRecipients(content, SNAPSHOT, targets, id), {
        enqueue: (command) => sent.push(command),
        pickMode,
        openEquipment: () => undefined,
        toggleWorkArea: () => undefined,
        siegeVehicles: () => [],
      }),
    );
    actions.assignVehicle(OWN);
    actions.leaveVehicle(RIDER);
    // The ring's removal gate: a settler holding no seat sends nothing.
    actions.leaveVehicle(OWN);
    expect(armed).toEqual([{ kind: 'vehicle', settler: OWN }]);
    expect(sent).toEqual([{ kind: 'detachFromVehicle', entity: RIDER }]);
  });
});

describe('the Rodzina row', () => {
  it('sends the plain marry at once, so the sim matches the nearest partner', () => {
    const { actions, sent, cues } = harness();
    actions.marry(OWN);
    actions.marry(FOREIGN);
    expect(sent).toEqual([{ kind: 'marry', entity: OWN }]);
    expect(cues).toEqual(['confirm', 'fail']);
  });
});
