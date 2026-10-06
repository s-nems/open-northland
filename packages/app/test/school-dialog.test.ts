import { MAX_UNIT_ORDER_MEMBERS, type PlayerCommand } from '@open-northland/sim';
import { beforeEach, expect, it, vi } from 'vitest';
import { JOB_COLLECTOR, JOB_JOINER } from '../src/catalog/jobs.js';
import { sandboxContent } from '../src/game/sandbox/index.js';
import { snapshotOf } from './support/snapshot.js';

const choice = vi.hoisted(() => ({ pick: undefined as ((key: string) => void) | undefined }));
vi.mock('../src/hud/dom/choice-window.js', () => ({
  createChoiceWindow: (opts: { onPick: (key: string) => void }) => {
    choice.pick = opts.onPick;
    return { show: () => {}, update: () => {}, dispose: () => {}, setUiScale: async () => {} };
  },
}));
// The app tests share a module registry; an earlier projection test may have loaded the real dialog.
vi.resetModules();
const { openSchoolDialog } = await import('../src/view/unit-controls/school-dialog.js');

beforeEach(() => {
  choice.pick = undefined;
});

function fixture(count: number) {
  const base = sandboxContent(),
    school = base.buildings.find((row) => row.schoolSize !== undefined);
  if (school === undefined) throw new Error('missing school');
  const content = {
    ...base,
    buildings: base.buildings.map((row) => (row === school ? { ...row, schoolSize: count } : row)),
  };
  const students = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    components: {
      Settler: { tribe: 1, jobType: JOB_COLLECTOR },
      Owner: { player: 0 },
    },
  }));
  const house = count + 1;
  const building = {
    id: house,
    components: { Building: { buildingType: school.typeId }, Owner: { player: 0 } },
  };
  return { content, students, house, building, snapshot: snapshotOf([...students, building]) };
}

it('submits one school gesture and skips courses learned since the dialog opened', () => {
  const f = fixture(1000),
    orders: PlayerCommand[] = [];
  let snapshot = f.snapshot;
  const dialog = openSchoolDialog({
    content: f.content,
    snapshot: () => snapshot,
    settlers: f.students.map(({ id }) => id),
    house: f.house,
    scale: 1,
    enqueue: (command) => orders.push(command),
  });
  expect(dialog).toBeDefined();
  snapshot = snapshotOf(
    [
      ...f.students.map((student, i) =>
        i === 0
          ? {
              ...student,
              components: {
                ...student.components,
                SettlerProgress: { learned: { job: [JOB_JOINER], good: [] } },
              },
            }
          : student,
      ),
      f.building,
    ],
    1,
  );
  choice.pick?.(String(JOB_JOINER));
  expect(orders).toEqual([
    {
      kind: 'unitActionGroup',
      members: f.students.slice(1).map(({ id: entity }) => ({ entity })),
      action: { kind: 'learn', house: f.house, target: 'job', typeId: JOB_JOINER },
    },
  ]);
});

it('refuses oversized school selections without opening or submitting', () => {
  const f = fixture(MAX_UNIT_ORDER_MEMBERS + 1),
    enqueue = vi.fn(),
    onOrderLimit = vi.fn();
  const dialog = openSchoolDialog({
    content: f.content,
    snapshot: () => f.snapshot,
    settlers: f.students.map(({ id }) => id),
    house: f.house,
    scale: 1,
    enqueue,
    onOrderLimit,
  });
  expect(dialog).toBeUndefined();
  expect(choice.pick).toBeUndefined();
  expect(enqueue).not.toHaveBeenCalled();
  expect(onOrderLimit).toHaveBeenCalledOnce();
});
