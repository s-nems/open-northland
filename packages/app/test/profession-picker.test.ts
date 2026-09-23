import { describe, expect, it } from 'vitest';
import type { PickerEntry } from '../src/catalog/professions.js';
import { professionChoices } from '../src/view/unit-controls/action-ring/profession-picker.js';

const ENTRIES: readonly PickerEntry[] = [
  { kind: 'profession', jobType: 0, label: 'Idle' },
  { kind: 'header', label: 'Gathering' },
  { kind: 'profession', jobType: 1, label: 'Collector' },
  { kind: 'header', label: 'Transport' },
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
});
