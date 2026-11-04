import { fx, type MatchOutcome } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { JOB_BUILDER, JOB_CHILD_FEMALE, JOB_SOLDIER_SWORD, JOB_WOMAN } from '../../../src/catalog/jobs.js';
import { seatStandings } from '../../../src/hud/summary/standings.js';
import { type Ent, snapshotOf } from '../../support/snapshot.js';

const HOME = 0;
const RIVAL = 1;
const QUIET = 2;
const BUILDING_TYPE = 3;
const HALF_BUILT = fx.fromFloat(0.5);

let nextId = 1;
function person(owner: number, jobType: number, female = false): Ent {
  return {
    id: nextId++,
    components: {
      Owner: { player: owner },
      Person: {},
      Settler: { jobType },
      ...(female ? { Female: {} } : {}),
    },
  };
}
function house(owner: number, built = fx.fromInt(1), constructing = false): Ent {
  return {
    id: nextId++,
    components: {
      Owner: { player: owner },
      Building: { buildingType: BUILDING_TYPE, built },
      ...(constructing ? { UnderConstruction: {} } : {}),
    },
  };
}

const undecided = (): MatchOutcome => 'undecided';

describe('seat standings', () => {
  it("count each seat's own people by sex, age and army, and its finished buildings alone", () => {
    const snapshot = snapshotOf([
      person(HOME, JOB_BUILDER),
      person(HOME, JOB_SOLDIER_SWORD),
      person(HOME, JOB_SOLDIER_SWORD),
      person(HOME, JOB_WOMAN, true),
      person(HOME, JOB_CHILD_FEMALE, true),
      house(HOME),
      house(HOME, HALF_BUILT),
      house(HOME, fx.fromInt(1), true),
      person(RIVAL, JOB_SOLDIER_SWORD),
      house(RIVAL),
      house(RIVAL),
    ]);

    const [home, rival] = seatStandings(snapshot, [HOME, RIVAL], undecided);

    expect(home?.people).toMatchObject({ men: 3, soldiers: 2, women: 1, children: 1, total: 5 });
    expect(home?.buildings).toBe(1);
    expect(rival?.people).toMatchObject({ men: 1, soldiers: 1, women: 0, children: 0, total: 1 });
    expect(rival?.buildings).toBe(2);
  });

  it('read a decided seat by its outcome, and a seat owning nothing as empty', () => {
    const snapshot = snapshotOf([person(HOME, JOB_BUILDER), house(RIVAL)]);
    const outcomes = new Map<number, MatchOutcome>([[RIVAL, 'defeat']]);

    const statuses = seatStandings(snapshot, [HOME, RIVAL, QUIET], (p) => outcomes.get(p) ?? 'undecided').map(
      (standing) => standing.status,
    );
    expect(statuses).toEqual(['playing', 'defeated', 'empty']);

    outcomes.set(HOME, 'victory');
    expect(seatStandings(snapshot, [HOME], (p) => outcomes.get(p) ?? 'undecided')[0]?.status).toBe('won');
  });
});
