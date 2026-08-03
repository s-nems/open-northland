import { describe, expect, it } from 'vitest';
import { JOB_ARCHER } from '../src/catalog/jobs.js';
import { actorsOf } from '../src/game/snapshot.js';
import {
  boundWorkers,
  FAMILY_GAP_FRAC,
  groupedWorkers,
  MAX_WORKERS,
} from '../src/hud/details-panel/worker-selection.js';
import { type Ent, snapshotOf, visitCountingSnapshot } from './support/snapshot.js';

const BUILDING = 100;
const OTHER = 200;

/** A settler entity carrying exactly the components a case needs (bare `Settler` marks it a worker). */
function sett(id: number, components: Record<string, unknown> = {}): Ent {
  return { id, components: { Settler: {}, ...components } };
}

describe('boundWorkers', () => {
  it('lists a settler assigned to the building, whether or not the site crew is wanted', () => {
    const snap = snapshotOf([sett(1, { JobAssignment: { workplace: BUILDING } })]);
    expect(boundWorkers(snap, BUILDING, false)).toEqual([1]);
    expect(boundWorkers(snap, BUILDING, true)).toEqual([1]);
  });

  it('ignores non-settlers and settlers assigned elsewhere', () => {
    const snap = snapshotOf([
      { id: 1, components: { Building: {} } },
      sett(2, { JobAssignment: { workplace: OTHER } }),
      sett(3, { JobAssignment: { workplace: BUILDING } }),
    ]);
    expect(boundWorkers(snap, BUILDING, false)).toEqual([3]);
  });

  it('lists the POSTED staff before the crew raising the site, so a full field keeps the posting', () => {
    // The crew is older than the posting in real play (builders exist before the foundation), so entity
    // order alone would push the posted worker out of a full field.
    const crew = Array.from({ length: MAX_WORKERS }, (_, i) =>
      sett(i + 1, { SiteAssignment: { site: BUILDING } }),
    );
    const snap = snapshotOf([...crew, sett(99, { JobAssignment: { workplace: BUILDING } })]);
    expect(boundWorkers(snap, BUILDING, true)[0]).toBe(99);
  });

  it('counts the construction crew and transient haulers only when the site crew is wanted', () => {
    const snap = snapshotOf([
      sett(1, { SiteAssignment: { site: BUILDING } }), // persistent crew membership
      sett(2, { CurrentAtomic: { targetEntity: BUILDING } }), // depositing there right now
      sett(3, { SupplyRun: { site: BUILDING } }), // on a supply errand for it
    ]);
    expect(boundWorkers(snap, BUILDING, false)).toEqual([]); // none are JobAssignment-bound
    expect(boundWorkers(snap, BUILDING, true)).toEqual([1, 2, 3]);
  });

  it('caps the list at MAX_WORKERS in snapshot order', () => {
    const many = Array.from({ length: MAX_WORKERS + 2 }, (_, i) =>
      sett(i + 1, { JobAssignment: { workplace: BUILDING } }),
    );
    const kept = boundWorkers(snapshotOf(many), BUILDING, false);
    expect(kept).toEqual(Array.from({ length: MAX_WORKERS }, (_, i) => i + 1));
  });

  it('lists the garrison before the rest of the staff, so a full tower never hides an archer', () => {
    // A big tower posts 12 (`logicworker` 4/4/4) into a field that fits MAX_WORKERS, and a man holding a
    // tower is `Resting` - the map neither draws nor picks him - so this strip is his only click target,
    // and clicking him is how the player cancels the posting. The haulers can always be clicked outside.
    const haulers = Array.from({ length: MAX_WORKERS }, (_, i) =>
      sett(i + 1, { JobAssignment: { workplace: BUILDING } }),
    );
    const archer = sett(99, {
      Settler: { jobType: JOB_ARCHER },
      JobAssignment: { workplace: BUILDING },
    });
    expect(boundWorkers(snapshotOf([...haulers, archer]), BUILDING, false)[0]).toBe(99);
  });

  it('lists a recruit drilling here after the staff, and not one drilling elsewhere', () => {
    const snap = snapshotOf([
      sett(1, { TrainingOrder: { house: BUILDING } }),
      sett(2, { JobAssignment: { workplace: BUILDING } }),
      sett(3, { TrainingOrder: { house: OTHER } }),
    ]);
    expect(boundWorkers(snap, BUILDING, false)).toEqual([2, 1]);
  });

  it('drops recruits before working posts when the field is full', () => {
    const entities = [
      sett(1, { TrainingOrder: { house: BUILDING } }),
      ...Array.from({ length: MAX_WORKERS }, (_, i) =>
        sett(i + 2, { JobAssignment: { workplace: BUILDING } }),
      ),
    ];
    const kept = boundWorkers(snapshotOf(entities), BUILDING, false);
    expect(kept).toEqual(Array.from({ length: MAX_WORKERS }, (_, i) => i + 2));
  });
});

describe('groupedWorkers', () => {
  it('flattens the groups in order and inserts a family gap before each new group', () => {
    const snap = snapshotOf([sett(1), sett(2), sett(3)]);
    const { ids, gaps } = groupedWorkers(snap, [[1, 2], [3]]);
    expect(ids).toEqual([1, 2, 3]);
    expect(gaps).toEqual([0, 0, FAMILY_GAP_FRAC]);
  });

  it('skips ids that are gone or are not settlers', () => {
    const snap = snapshotOf([sett(1), { id: 2, components: { Building: {} } }]);
    const { ids, gaps } = groupedWorkers(snap, [[1, 2, 999]]);
    expect(ids).toEqual([1]); // 2 is a building, 999 died between frames
    expect(gaps).toEqual([0]);
  });

  it('caps the flattened list at MAX_WORKERS across groups', () => {
    const snap = snapshotOf(Array.from({ length: MAX_WORKERS + 3 }, (_, i) => sett(i + 1)));
    const { ids } = groupedWorkers(snap, [
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10, 11],
    ]);
    expect(ids).toEqual(Array.from({ length: MAX_WORKERS }, (_, i) => i + 1));
  });
});

/**
 * Neither selector may add a walk of its own over a decoded map's scenery while a building is selected.
 * Pinned here because nothing else fails when one silently goes back to `snapshot.entities`: the results
 * are identical either way, only the per-tick cost changes.
 */
describe('cost follows the selection, not the map', () => {
  const SCENERY = 400;
  /** One bound worker among a decoded map's worth of scenery. */
  const crowded = () =>
    snapshotOf([
      sett(1, { JobAssignment: { workplace: BUILDING } }),
      ...Array.from({ length: SCENERY }, (_, i) => ({
        id: i + 10,
        components: { Resource: { goodType: 1 } },
      })),
    ]);

  it('boundWorkers rides the snapshot-shared actors walk instead of adding one', () => {
    const { snapshot, visits } = visitCountingSnapshot(crowded());
    actorsOf(snapshot); // the walk the frame's other projections already paid for
    const shared = visits();
    expect(boundWorkers(snapshot, BUILDING, false)).toEqual([1]);
    expect(visits()).toBe(shared);
  });

  it('groupedWorkers reads only the ids it was handed', () => {
    const { snapshot, visits } = visitCountingSnapshot(crowded());
    expect(groupedWorkers(snapshot, [[1]]).ids).toEqual([1]);
    expect(visits()).toBeLessThan(SCENERY / 4);
  });
});
