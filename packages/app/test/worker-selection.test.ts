import { describe, expect, it } from 'vitest';
import {
  boundWorkers,
  FAMILY_GAP_FRAC,
  groupedEntities,
  MAX_WORKERS,
} from '../src/hud/details-panel/worker-selection.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const BUILDING = 100;
const OTHER = 200;

/** A settler entity carrying exactly the components a case needs (bare `Settler` marks it a worker). */
function sett(id: number, components: Record<string, unknown> = {}): Ent {
  return { id, components: { Settler: {}, ...components } };
}

function idsOf(entities: readonly Ent[]): number[] {
  return entities.map((e) => e.id);
}

describe('boundWorkers', () => {
  it('lists a settler assigned to the building, whether or not the site crew is wanted', () => {
    const snap = snapshotOf([sett(1, { JobAssignment: { workplace: BUILDING } })]);
    expect(idsOf(boundWorkers(snap, BUILDING, false))).toEqual([1]);
    expect(idsOf(boundWorkers(snap, BUILDING, true))).toEqual([1]);
  });

  it('ignores non-settlers and settlers assigned elsewhere', () => {
    const snap = snapshotOf([
      { id: 1, components: { Building: {} } },
      sett(2, { JobAssignment: { workplace: OTHER } }),
      sett(3, { JobAssignment: { workplace: BUILDING } }),
    ]);
    expect(idsOf(boundWorkers(snap, BUILDING, false))).toEqual([3]);
  });

  it('counts the construction crew and transient haulers only when the site crew is wanted', () => {
    const snap = snapshotOf([
      sett(1, { SiteAssignment: { site: BUILDING } }), // persistent crew membership
      sett(2, { CurrentAtomic: { targetEntity: BUILDING } }), // depositing there right now
      sett(3, { SupplyRun: { site: BUILDING } }), // on a supply errand for it
    ]);
    expect(idsOf(boundWorkers(snap, BUILDING, false))).toEqual([]); // none are JobAssignment-bound
    expect(idsOf(boundWorkers(snap, BUILDING, true))).toEqual([1, 2, 3]);
  });

  it('caps the list at MAX_WORKERS in snapshot order', () => {
    const many = Array.from({ length: MAX_WORKERS + 2 }, (_, i) =>
      sett(i + 1, { JobAssignment: { workplace: BUILDING } }),
    );
    const kept = boundWorkers(snapshotOf(many), BUILDING, false);
    expect(kept).toHaveLength(MAX_WORKERS);
    expect(idsOf(kept)).toEqual(Array.from({ length: MAX_WORKERS }, (_, i) => i + 1));
  });
});

describe('groupedEntities', () => {
  it('flattens the groups in order and inserts a family gap before each new group', () => {
    const snap = snapshotOf([sett(1), sett(2), sett(3)]);
    const { entities, gaps } = groupedEntities(snap, [[1, 2], [3]]);
    expect(idsOf(entities)).toEqual([1, 2, 3]);
    expect(gaps).toEqual([0, 0, FAMILY_GAP_FRAC]);
  });

  it('skips ids that are gone or are not settlers', () => {
    const snap = snapshotOf([sett(1), { id: 2, components: { Building: {} } }]);
    const { entities, gaps } = groupedEntities(snap, [[1, 2, 999]]);
    expect(idsOf(entities)).toEqual([1]); // 2 is a building, 999 died between frames
    expect(gaps).toEqual([0]);
  });

  it('caps the flattened list at MAX_WORKERS across groups', () => {
    const snap = snapshotOf(Array.from({ length: MAX_WORKERS + 3 }, (_, i) => sett(i + 1)));
    const { entities } = groupedEntities(snap, [
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10, 11],
    ]);
    expect(entities).toHaveLength(MAX_WORKERS);
    expect(idsOf(entities)).toEqual(Array.from({ length: MAX_WORKERS }, (_, i) => i + 1));
  });
});
