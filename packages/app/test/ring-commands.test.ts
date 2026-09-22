import { type PlayerCommand, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import type { PickMode, PickModeController } from '../src/view/unit-controls/pick-mode.js';
import { issueRingCommand } from '../src/view/unit-controls/ring-commands.js';

/** A dispatcher harness recording what a click issued and what it armed. */
function harness(): {
  issued: PlayerCommand[];
  armed: PickMode[];
  equipmentFor: number[][];
  workAreaFor: number[][];
  pickMode: PickModeController;
  enqueue: (command: PlayerCommand) => void;
  openEquipment: (settlers: readonly number[]) => void;
  toggleWorkArea: (targets: readonly number[]) => void;
} {
  const issued: PlayerCommand[] = [];
  const armed: PickMode[] = [];
  const equipmentFor: number[][] = [];
  const workAreaFor: number[][] = [];
  const pickMode: PickModeController = {
    arm: (mode) => {
      armed.push(mode);
    },
    cancel: () => undefined,
    isArmed: () => armed.length > 0,
    signpostActive: () => false,
    handleMouseDown: () => null,
    handleOverviewPress: () => null,
    highlight: () => null,
  };
  return {
    issued,
    armed,
    equipmentFor,
    workAreaFor,
    pickMode,
    enqueue: (command) => issued.push(command),
    openEquipment: (settlers) => equipmentFor.push([...settlers]),
    toggleWorkArea: (targets) => workAreaFor.push([...targets]),
  };
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

  it('arms a place pick for the whole group and a scout pick for one scout only', () => {
    const h = harness();
    issueRingCommand('assignHome', [4], h);
    issueRingCommand('assignLearningPlace', [4], h);
    issueRingCommand('erectSignpost', [7], h);
    issueRingCommand('assignWorkPlace', [4, 9], h);
    issueRingCommand('erectSignpost', [7, 8], h);
    expect(h.armed).toEqual([
      { kind: 'home', settlers: [4] },
      { kind: 'learning-place', settlers: [4] },
      { kind: 'signpost', scout: 7 },
      { kind: 'workplace', settlers: [4, 9] },
    ]);
    expect(h.issued).toEqual([]);
  });

  it('arms the selection-wide picks for the settlers the order was allowed for', () => {
    const h = harness();
    issueRingCommand('goTo', [4, 9], h);
    issueRingCommand('attackBuilding', [4, 9], h);
    issueRingCommand('attackAnimal', [4, 9], h);
    issueRingCommand('attackPosition', [4], h);
    expect(h.armed).toEqual([
      { kind: 'destination', units: [4, 9] },
      { kind: 'attack-building', units: [4, 9] },
      { kind: 'attack-animal', units: [4, 9] },
      { kind: 'attack-move', units: [4] },
    ]);
  });

  it('orders nobody once the order`s gate shut on every settler', () => {
    const h = harness();
    issueRingCommand('marry', [], h);
    issueRingCommand('assignHome', [], h);
    expect(h.issued).toEqual([]);
    expect(h.armed).toEqual([]);
  });

  it('orders each of the four needs by the bar it answers', () => {
    const h = harness();
    issueRingCommand('eat', [4], h);
    issueRingCommand('sleep', [4], h);
    issueRingCommand('talk', [4], h);
    issueRingCommand('pray', [4], h);
    expect(h.issued).toEqual([
      { kind: 'orderNeed', entity: 4, need: 'hunger' },
      { kind: 'orderNeed', entity: 4, need: 'fatigue' },
      { kind: 'orderNeed', entity: 4, need: 'enjoyment' },
      { kind: 'orderNeed', entity: 4, need: 'piety' },
    ]);
  });

  it('flips regeneration and releases a site or a drill', () => {
    const h = harness();
    issueRingCommand('prohibitRegeneration', [4, 9], h);
    issueRingCommand('allowRegeneration', [4], h);
    issueRingCommand('removeBuildingSite', [4], h);
    issueRingCommand('removeLearningPlace', [4], h);
    expect(h.issued).toEqual([
      { kind: 'setRegeneration', entity: 4, enabled: false },
      { kind: 'setRegeneration', entity: 9, enabled: false },
      { kind: 'setRegeneration', entity: 4, enabled: true },
      { kind: 'unassignBuilder', entity: 4 },
      { kind: 'cancelTraining', entity: 4 },
    ]);
  });

  it('routes the two view-only orders to their own seams', () => {
    const h = harness();
    issueRingCommand('changeEquipment', [4, 9], h);
    issueRingCommand('showWorkArea', [4], h);
    issueRingCommand('explore', [7], h);
    expect(h.equipmentFor).toEqual([[4, 9]]);
    expect(h.workAreaFor).toEqual([[4]]);
    expect(h.armed).toEqual([{ kind: 'explore', scout: 7 }]);
    expect(h.issued).toEqual([]);
  });
});
