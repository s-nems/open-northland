import { describe, expect, it } from 'vitest';
import type { AuthoredJoinRows, AuthoredPlacement } from '../src/game/world/index.js';
import { authoredCatalogExtras } from '../src/game/world/index.js';

const building = (typeId: number, tribe = 1): AuthoredPlacement => ({
  kind: 'building',
  typeId,
  tribe,
  x: 0,
  y: 0,
});
const human = (jobType: number, tribe = 1): AuthoredPlacement => ({
  kind: 'human',
  jobType,
  tribe,
  x: 0,
  y: 0,
});
const animal = (tribe: number): AuthoredPlacement => ({ kind: 'animal', tribe, x: 0, y: 0 });

const ROWS: AuthoredJoinRows = {
  buildings: [
    { typeId: 7, id: 'smithy', kind: 'workplace' },
    { typeId: 9, id: 'longhouse', kind: 'home' },
    { typeId: 11, id: 'watchtower' },
    { typeId: 13 },
  ],
};

describe('authored catalog extras', () => {
  it('names placed buildings from the IR rows, carrying an authored kind', () => {
    const extras = authoredCatalogExtras([building(9), building(11)], ROWS);

    expect(extras.buildings).toEqual([
      { typeId: 9, id: 'longhouse', kind: 'home' },
      // No kind in the IR row: the sandbox assembler owns that default, not this fold.
      { typeId: 11, id: 'watchtower' },
    ]);
  });

  it('falls back to a typeId-derived id for a building the IR does not name', () => {
    const extras = authoredCatalogExtras([building(13), building(42)], ROWS);

    expect(extras.buildings).toEqual([
      { typeId: 13, id: 'building_13' },
      { typeId: 42, id: 'building_42' },
    ]);
  });

  it('keeps every authored job but the idle default', () => {
    const extras = authoredCatalogExtras([human(0), human(4), human(2)], ROWS);

    expect(extras.jobs).toEqual([
      { typeId: 2, id: 'job_2' },
      { typeId: 4, id: 'job_4' },
    ]);
  });

  it('collects the tribes of every placement kind, herds included', () => {
    const extras = authoredCatalogExtras([building(7, 2), human(4, 1), human(4, 2), animal(5)], ROWS);

    expect(extras.tribes).toEqual([
      { typeId: 1, id: 'tribe_1' },
      { typeId: 2, id: 'tribe_2' },
      { typeId: 5, id: 'tribe_5' },
    ]);
  });

  it('dedups and sorts ascending, whatever order the map authored', () => {
    const extras = authoredCatalogExtras([building(11), building(7), building(11), human(5), human(3)], {
      ...ROWS,
      buildings: [],
    });

    expect(extras.buildings?.map((b) => b.typeId)).toEqual([7, 11]);
    expect(extras.jobs?.map((j) => j.typeId)).toEqual([3, 5]);
  });

  it('derives nothing from an empty placement list', () => {
    const extras = authoredCatalogExtras([], ROWS);

    expect(extras).toEqual({ buildings: [], jobs: [], tribes: [] });
  });
});
