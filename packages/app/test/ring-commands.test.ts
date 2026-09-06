import { type PlayerCommand, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { PickMode, PickModeController } from '../src/view/unit-controls/pick-mode.js';
import { issueRingCommand } from '../src/view/unit-controls/ring-commands.js';

/** A dispatcher harness recording what a click issued and what it armed. */
function harness(): {
  issued: PlayerCommand[];
  armed: PickMode[];
  pickMode: PickModeController;
  enqueue: (command: PlayerCommand) => void;
} {
  const issued: PlayerCommand[] = [];
  const armed: PickMode[] = [];
  const pickMode: PickModeController = {
    arm: (mode) => {
      armed.push(mode);
    },
    cancel: () => undefined,
    isArmed: () => armed.length > 0,
    signpostActive: () => false,
    handleMouseDown: () => false,
    highlight: () => null,
  };
  return { issued, armed, pickMode, enqueue: (command) => issued.push(command) };
}

describe('issueRingCommand', () => {
  it('fans an immediate order out to every target', () => {
    const h = harness();
    issueRingCommand('defenceMode', [4, 9], h);
    expect(h.issued).toEqual([
      { kind: 'setStance', entity: 4, mode: systems.MILITARY_MODE.DEFEND },
      { kind: 'setStance', entity: 9, mode: systems.MILITARY_MODE.DEFEND },
    ]);
    issueRingCommand('haveGirl', [4], h);
    expect(h.issued.at(-1)).toEqual({ kind: 'makeChild', entity: 4, child: 'female' });
    expect(h.armed).toEqual([]);
  });

  it('arms a place pick for the one settler and refuses it for several', () => {
    const h = harness();
    issueRingCommand('assignHome', [4], h);
    issueRingCommand('assignLearningPlace', [4], h);
    issueRingCommand('erectSignpost', [7], h);
    issueRingCommand('assignWorkPlace', [4, 9], h);
    expect(h.armed).toEqual([
      { kind: 'home', settler: 4 },
      { kind: 'learning-place', settler: 4 },
      { kind: 'signpost', scout: 7 },
    ]);
    expect(h.issued).toEqual([]);
  });

  it('arms the selection-wide picks without naming a settler', () => {
    const h = harness();
    issueRingCommand('goTo', [4, 9], h);
    issueRingCommand('attackBuilding', [4, 9], h);
    issueRingCommand('attackPosition', [4, 9], h);
    expect(h.armed.map((m) => m.kind)).toEqual(['destination', 'attack-building', 'attack-move']);
  });
});
