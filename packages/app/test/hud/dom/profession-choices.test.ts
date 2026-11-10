import { describe, expect, it } from 'vitest';
import { JOB_BUILDER, JOB_CARRIER, JOB_CIVILIST, JOB_POTTER } from '../../../src/catalog/jobs.js';
import { LEADING_PROFESSION, type PickerEntry, pickerEntries } from '../../../src/catalog/professions.js';
import { professionChoices } from '../../../src/hud/dom/profession-choices.js';

const ENTRIES: readonly PickerEntry[] = [
  { kind: 'header', label: 'Basic' },
  { kind: 'profession', jobType: 0, label: 'Idle' },
  { kind: 'header', label: 'Special' },
  { kind: 'header', label: 'Production' },
  { kind: 'profession', jobType: 2, label: 'Joiner' },
  { kind: 'profession', jobType: 3, label: 'Mason' },
];

describe('professionChoices', () => {
  it('drops hidden professions and groups with no visible jobs', () => {
    const groups = professionChoices(
      ENTRIES,
      (job) => job === 2,
      () => false,
      () => 'Needs experience',
    );
    expect(groups).toEqual([
      {
        label: 'Production',
        rows: [{ key: '2', label: 'Joiner', reason: 'Needs experience' }],
      },
    ]);
  });

  it('keeps one header above several visible jobs in the same group', () => {
    expect(
      professionChoices(
        ENTRIES,
        (job) => job === 2 || job === 3,
        () => true,
      ),
    ).toEqual([
      {
        label: 'Production',
        rows: [
          { key: '2', label: 'Joiner' },
          { key: '3', label: 'Mason' },
        ],
      },
    ]);
  });

  it('lists the leading profession first and the rest of its group by name', () => {
    const groups = professionChoices(
      [
        { kind: 'header', label: 'Basic' },
        { kind: 'profession', jobType: JOB_CIVILIST, label: 'Civilian' },
        { kind: 'profession', jobType: LEADING_PROFESSION, label: 'Worker' },
        { kind: 'profession', jobType: JOB_CARRIER, label: 'Carrier' },
      ],
      () => true,
      () => true,
    );
    expect(groups[0]?.rows.map((row) => row.label)).toEqual(['Worker', 'Carrier', 'Civilian']);
  });

  it('leads each trade with its products, and non-producing trades with none', () => {
    const rows = professionChoices(
      pickerEntries(),
      () => true,
      () => true,
    ).flatMap((group) => group.rows);
    expect(rows.find((row) => row.key === String(JOB_POTTER))?.goodIds).toEqual([
      'brick',
      'tile',
      'crockery',
    ]);
    expect(rows.find((row) => row.key === String(JOB_BUILDER))?.goodIds).toBeUndefined();
    const civilist = rows.find((row) => row.key === String(JOB_CIVILIST));
    expect(civilist).toBeDefined();
    expect(civilist?.goodIds).toBeUndefined();
  });
});
