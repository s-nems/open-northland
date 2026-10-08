import type { UiCue } from '@open-northland/audio';
import type { Camera } from '@open-northland/render';
import type { PlayerCommand } from '@open-northland/sim';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HUMAN_PLAYER } from '../src/game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_WAREHOUSE_00,
  BUILDING_WATCHTOWER,
} from '../src/game/sandbox/ids/index.js';
import type { ActionOrderId } from '../src/hud/action-ring/index.js';
import { DEFAULT_KEY_BINDINGS } from '../src/hud/keybindings.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import { createKeyboardOrders, type KeyboardOrdersDeps } from '../src/view/unit-controls/keyboard-orders.js';
import { buildingEntity, snapshotOf } from './support/sandbox.js';

/** The typing-target guard probes DOM classes the node test environment lacks. */
beforeEach(() => {
  for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLElement']) {
    vi.stubGlobal(name, class {});
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const content = createSceneSim(sandboxScene).content;

function key(code: string, shiftKey = false): KeyboardEvent {
  return {
    code,
    shiftKey,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    repeat: false,
    target: null,
  } as never;
}

function mount(overrides: Partial<KeyboardOrdersDeps> = {}) {
  let camera: Camera = { offsetX: 0, offsetY: 0 };
  const centred: number[] = [];
  const ringOrders: ActionOrderId[] = [];
  const sent: PlayerCommand[] = [];
  const cues: UiCue[] = [];
  const snapshot = snapshotOf([
    buildingEntity(1, BUILDING_WAREHOUSE_00),
    buildingEntity(2, BUILDING_HEADQUARTERS),
    buildingEntity(3, BUILDING_WATCHTOWER),
  ]);
  const handle = createKeyboardOrders({
    bindings: DEFAULT_KEY_BINDINGS,
    snapshot: () => snapshot,
    content,
    player: () => HUMAN_PLAYER,
    selected: () => new Set(),
    select: () => undefined,
    camera: () => camera,
    // Each target gets its own frame, so the test can tell the jumps apart.
    centreOn: (id) => {
      centred.push(id);
      camera = { offsetX: id * 100, offsetY: 0 };
      return true;
    },
    enqueue: (command) => sent.push(command),
    ringOrder: (id) => {
      ringOrders.push(id);
      return id === 'assignBuildingSite';
    },
    cue: (cue) => cues.push(cue),
    ...overrides,
  });
  return {
    handle,
    centred,
    ringOrders,
    sent,
    cues,
    pan: (): void => {
      camera = { offsetX: camera.offsetX + 1, offsetY: camera.offsetY };
    },
  };
}

describe('keyboard orders', () => {
  it('step from the headquarters through the warehouses while the camera stays, and restart after a pan', () => {
    const { handle, centred, pan } = mount();
    for (let i = 0; i < 3; i++) expect(handle(key('KeyH'))).toBe(true);
    pan();
    handle(key('KeyH'));
    expect(centred).toEqual([2, 1, 2, 2]);
  });

  it('give a builder its building site before any work place', () => {
    const { handle, ringOrders } = mount();
    handle(key('KeyQ'));
    expect(ringOrders).toEqual(['assignBuildingSite']);
  });

  it('fall back to the work place for anyone the building site refuses', () => {
    const asked: ActionOrderId[] = [];
    const { handle } = mount({
      ringOrder: (id) => {
        asked.push(id);
        return false;
      },
    });
    handle(key('KeyQ'));
    expect(asked).toEqual(['assignBuildingSite', 'assignWorkPlace']);
  });

  it('open the equipment window through the ring order, so the key gates as the ring button does', () => {
    const { handle, ringOrders } = mount();
    expect(handle(key('KeyI'))).toBe(true);
    expect(ringOrders).toEqual(['changeEquipment']);
  });

  it('raise the defence in every building that has one, and fail a press with nothing to change', () => {
    const { handle, sent, cues } = mount();
    handle(key('KeyV'));
    handle(key('KeyV', true));
    expect(sent.map((command) => (command.kind === 'setDefenceMode' ? command.building : null))).toEqual([
      2, 3,
    ]);
    expect(cues).toEqual(['confirm', 'fail']);
  });

  it('take no key while the viewer plays no seat', () => {
    const { handle, centred } = mount({ player: () => null });
    expect(handle(key('KeyH'))).toBe(false);
    expect(centred).toEqual([]);
  });
});
