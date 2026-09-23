import { describe, expect, it } from 'vitest';
import type { PickerEntry } from '../src/catalog/professions.js';
import { professionPickerRows } from '../src/view/unit-controls/action-ring/profession-picker.js';

const ENTRIES: readonly PickerEntry[] = [
  { kind: 'profession', jobType: 0, label: 'Idle' },
  { kind: 'header', label: 'Gathering' },
  { kind: 'profession', jobType: 1, label: 'Collector' },
  { kind: 'header', label: 'Production' },
  { kind: 'profession', jobType: 2, label: 'Joiner' },
  { kind: 'profession', jobType: 3, label: 'Mason' },
];

describe('professionPickerRows', () => {
  it('drops hidden professions and headers with no visible jobs', () => {
    expect(
      professionPickerRows(
        ENTRIES,
        (jobType) => jobType === 0 || jobType === 2,
        (jobType) => jobType === 0,
        () => 'Needs experience',
      ),
    ).toEqual([
      { entry: { kind: 'profession', jobType: 0, label: 'Idle' } },
      { entry: { kind: 'header', label: 'Production' } },
      {
        entry: { kind: 'profession', jobType: 2, label: 'Joiner' },
        blocked: 'Needs experience',
      },
    ]);
  });

  it('keeps one header above several visible jobs in the same group', () => {
    expect(
      professionPickerRows(
        ENTRIES,
        (jobType) => jobType === 2 || jobType === 3,
        () => true,
      ),
    ).toEqual([
      { entry: { kind: 'header', label: 'Production' } },
      { entry: { kind: 'profession', jobType: 2, label: 'Joiner' } },
      { entry: { kind: 'profession', jobType: 3, label: 'Mason' } },
    ]);
  });
});
