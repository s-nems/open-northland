import { describe, expect, it } from 'vitest';
import { ACTION_COMMANDS, type ActionCommand } from '../src/hud/action-ring/index.js';
import { createActionRingInput } from '../src/view/unit-controls/action-ring/input.js';
import type { MenuMode } from '../src/view/unit-controls/action-ring/types.js';

const TARGETS = [4, 9] as const;

function command(id: ActionCommand['id']): ActionCommand {
  const found = ACTION_COMMANDS.find((c) => c.id === id);
  if (found === undefined) throw new Error(`no command ${id}`);
  return found;
}

/** The ring input over a recording mount: every seam call lands in `calls`, in order. */
function harness(mode: MenuMode, ringVisible = true) {
  const calls: string[] = [];
  let targets: readonly number[] = TARGETS;
  const input = createActionRingInput({
    showTip: (text) => calls.push(`tip ${text}`),
    hideTip: () => calls.push('hideTip'),
    toCanvas: (x, y) => ({ x, y }),
    getMode: () => mode,
    isRingVisible: () => ringVisible,
    getLayout: () => ({ buttons: [], bounds: { x: 0, y: 0, w: 0, h: 0 } }),
    getTargets: () => targets,
    onCommand: (id, to) => calls.push(`command ${id} ${to.join(',')}`),
    cue: (cue) => calls.push(`cue ${cue}`),
    openJobWindow: () => calls.push('openJobWindow'),
    closeMenu: () => {
      calls.push('closeMenu');
      // Closing ends the session the targets belong to.
      targets = [];
    },
  });
  const event = {
    stopped: false,
    preventDefault(): void {},
    stopPropagation(): void {
      this.stopped = true;
    },
  };
  return { input, calls, event };
}

describe('action ring button presses', () => {
  it("sends the order to the session's targets, read before the ring closes, and keeps the press", () => {
    const { input, calls, event } = harness('menu');

    input.press(command('sleep'), event);

    expect(calls).toEqual(['cue confirm', 'closeMenu', `command sleep ${TARGETS.join(',')}`]);
    expect(event.stopped).toBe(true);
  });

  it('opens the profession list for the trade order, leaving the session open', () => {
    const { input, calls } = harness('menu');

    input.press(command('changeProfession'), { preventDefault() {}, stopPropagation() {} });

    expect(calls).toEqual(['cue confirm', 'openJobWindow']);
  });

  it('ignores a press while the ring is closed, showing the list, or hidden', () => {
    for (const { mode, visible } of [
      { mode: 'closed', visible: true },
      { mode: 'jobs', visible: true },
      { mode: 'menu', visible: false },
    ] as const) {
      const { input, calls, event } = harness(mode, visible);

      input.press(command('sleep'), event);

      expect(calls).toEqual([]);
      expect(event.stopped).toBe(false);
    }
  });
});
