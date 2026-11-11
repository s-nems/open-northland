import { beforeEach, expect, it, vi } from 'vitest';
import type { PickerEntry } from '../../../../src/catalog/professions.js';
import type { ChoiceGroup } from '../../../../src/hud/dom/choice-window.js';
import { STILL_CAMERA } from '../../../support/still-camera.js';

const choice = vi.hoisted(() => ({
  pick: undefined as ((key: string) => void) | undefined,
  dismiss: undefined as (() => void) | undefined,
  groups: [] as readonly ChoiceGroup[],
}));
vi.mock('../../../../src/hud/dom/choice-window.js', () => ({
  createChoiceWindow: (opts: { onPick: (key: string) => void; onDismiss: () => void }) => {
    choice.pick = opts.onPick;
    choice.dismiss = opts.onDismiss;
    return {
      show: () => {},
      hide: () => {},
      update: (groups: readonly ChoiceGroup[]) => {
        choice.groups = groups;
      },
      scrollTop: () => 0,
      setScrollTop: () => {},
      dispose: () => {},
    };
  },
}));
// The app tests share a module registry; an earlier test may have loaded the real window.
vi.resetModules();
const { createProfessionPicker } = await import(
  '../../../../src/view/unit-controls/action-ring/profession-picker.js'
);

const GATHERER = 8;
const BUILDER = 7;
const WOOD = 5;
const STONE = 3;
const PROFESSIONS: readonly PickerEntry[] = [
  { kind: 'header', label: 'basic' },
  { kind: 'profession', jobType: BUILDER, label: 'builder' },
  { kind: 'profession', jobType: GATHERER, label: 'gatherer' },
];
const GOODS = [
  { goodType: WOOD, goodId: 'wood', label: 'wood' },
  { goodType: STONE, goodId: 'stone', label: 'stone' },
];

function open() {
  const picks: [number, (readonly number[])?][] = [];
  const onDismiss = vi.fn();
  const picker = createProfessionPicker({
    professions: PROFESSIONS,
    scale: 1,
    camera: STILL_CAMERA,
    cue: () => {},
    onDismiss,
    onPick: (job, goods) => picks.push(goods === undefined ? [job] : [job, goods]),
  });
  picker.show(
    () => true,
    () => true,
    undefined,
    (job) => (job === GATHERER ? GOODS : []),
  );
  return { picks, onDismiss };
}

const keys = (): string[] => choice.groups.flatMap((group) => group.rows.map((row) => row.key));

beforeEach(() => {
  choice.groups = [];
});

it('picks a trade without goods at once', () => {
  const { picks } = open();
  choice.pick?.(String(BUILDER));
  expect(picks).toEqual([[BUILDER]]);
});

it("opens a gatherer's goods under every good, and orders the trade with the picked one", () => {
  const { picks } = open();
  choice.pick?.(String(GATHERER));
  expect(picks).toEqual([]);
  expect(keys()).toEqual(['all', String(WOOD), String(STONE)]);

  choice.pick?.(String(STONE));
  choice.pick?.('all');
  expect(picks).toEqual([
    [GATHERER, [STONE]],
    [GATHERER, []],
  ]);
});

it('steps back from the goods to the trades on dismiss', () => {
  const { onDismiss } = open();
  choice.pick?.(String(GATHERER));
  choice.dismiss?.();
  expect(onDismiss).not.toHaveBeenCalled();
  expect(keys()).toEqual([String(BUILDER), String(GATHERER)]);

  choice.dismiss?.();
  expect(onDismiss).toHaveBeenCalledOnce();
});
