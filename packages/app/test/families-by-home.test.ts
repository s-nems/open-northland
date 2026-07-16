import { describe, expect, it } from 'vitest';
import { familiesByHome } from '../src/game/snapshot.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

/**
 * `familiesByHome` — the ONE snapshot grouping the door badges, the assign-home highlight, and the
 * home panel all consume (the mirror of the sim's `familiesOf`; the sim command is the validator).
 * Pinned here because its trickiest branches — the orphaned minor, the child housed apart from its
 * parents, couple-vs-single classification — regress silently through any single consumer's test.
 */

const HOME = 100;
const OTHER_HOME = 200;

/** A settler living in `home`; `age` marks a minor, `marriage` links a spouse/child. */
function resident(
  id: number,
  home: number,
  opts: { minor?: boolean; spouse?: number; child?: number | null } = {},
): Ent {
  return {
    id,
    components: {
      Settler: { jobType: 0, tribe: 1 },
      Residence: { home },
      ...(opts.minor === true ? { Age: { ticks: 0 } } : {}),
      ...(opts.spouse !== undefined ? { Marriage: { spouse: opts.spouse, child: opts.child ?? null } } : {}),
    },
  };
}

describe('familiesByHome', () => {
  it('groups a couple and their growing child as ONE family under the lower-id head', () => {
    const snapshot = snapshotOf([
      resident(1, HOME, { spouse: 2, child: 3 }),
      resident(2, HOME, { spouse: 1, child: 3 }),
      resident(3, HOME, { minor: true }),
    ]);
    const families = familiesByHome(snapshot).get(HOME);
    expect(families).toHaveLength(1);
    expect(families?.[0]).toEqual({ members: [1, 2, 3], adults: 2, minors: 1 });
  });

  it('keeps unrelated singles in separate family slots', () => {
    const snapshot = snapshotOf([resident(1, HOME), resident(2, HOME)]);
    const families = familiesByHome(snapshot).get(HOME);
    expect(families).toHaveLength(2);
    expect(families?.map((f) => f.members)).toEqual([[1], [2]]);
  });

  it('a spouse living in a DIFFERENT home does not join the group', () => {
    const snapshot = snapshotOf([resident(1, HOME, { spouse: 2 }), resident(2, OTHER_HOME, { spouse: 1 })]);
    const byHome = familiesByHome(snapshot);
    expect(byHome.get(HOME)?.[0]).toEqual({ members: [1], adults: 1, minors: 0 });
    expect(byHome.get(OTHER_HOME)?.[0]).toEqual({ members: [2], adults: 1, minors: 0 });
  });

  it('an orphaned minor (no cohabiting parents) holds its own family slot', () => {
    const snapshot = snapshotOf([
      resident(1, HOME),
      // Minor 5: no resident parent names it as `Marriage.child`.
      resident(5, HOME, { minor: true }),
    ]);
    const families = familiesByHome(snapshot).get(HOME);
    expect(families).toHaveLength(2);
    expect(families?.map((f) => f.members)).toEqual([[1], [5]]);
    expect(families?.[1]).toEqual({ members: [5], adults: 0, minors: 1 });
  });

  it('a child housed apart from its parents is its own slot in ITS home', () => {
    const snapshot = snapshotOf([
      resident(1, HOME, { spouse: 2, child: 3 }),
      resident(2, HOME, { spouse: 1, child: 3 }),
      resident(3, OTHER_HOME, { minor: true }),
    ]);
    const byHome = familiesByHome(snapshot);
    expect(byHome.get(HOME)?.[0]).toEqual({ members: [1, 2], adults: 2, minors: 0 });
    expect(byHome.get(OTHER_HOME)?.[0]).toEqual({ members: [3], adults: 0, minors: 1 });
  });

  it('non-resident and non-settler entities are ignored', () => {
    const snapshot = snapshotOf([
      { id: 1, components: { Settler: { jobType: 0 } } }, // homeless
      { id: HOME, components: { Building: { buildingType: 1 }, Residence: { home: HOME } } },
      resident(3, HOME),
    ]);
    const families = familiesByHome(snapshot).get(HOME);
    expect(families?.map((f) => f.members)).toEqual([[3]]);
  });
});
