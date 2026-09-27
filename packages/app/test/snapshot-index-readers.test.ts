import {
  MirrorTruth,
  type Simulation,
  SnapshotMirror,
  systems,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { workerRoleOf } from '../src/game/sandbox/worker-roles.js';
import {
  actorsOf,
  builderCrewSize,
  homeFamiliesOf,
  isSettler,
  needsRuleEnabled,
  ownedByComputerSeat,
  progressionGatesSettler,
  type SnapshotEntity,
  shelterClaimCount,
  shelterersOf,
  siteCrewOf,
  staffOf,
  supplyRunsTo,
  surnameSourceOf,
  trainingOccupancyOf,
} from '../src/game/snapshot.js';
import { raisingCrew, shelteringIn } from '../src/hud/details-panel/model/building-staff.js';
import { createSceneSim, getScene } from '../src/scenes/index.js';
import { computeConstructionSigns } from '../src/view/projections/construction-signs.js';
import { computeDoorBadges } from '../src/view/projections/door-badges.js';
import { computeLifeHearts, type LifeHeartInputs } from '../src/view/projections/life-hearts.js';
import { computeSettlerBubbles } from '../src/view/projections/settler-bubbles.js';

/**
 * The snapshot readers answer from indexes a mirror maintains per delta. After every delta each one must
 * equal what a fresh walk over the same entity list builds, so no change the sim makes leaves a view
 * stale, and the `debug=diag` checks (the delta digest and `verifyIndexes`) must find nothing to report.
 */

/** A digest-carrying stream into a mirror, checked the way a `debug=diag` session checks it. */
function checkedMirror(sim: Simulation): { readonly mirror: SnapshotMirror; advance(): void } {
  const deltas = sim.snapshotDeltas({ digest: true });
  const mirror = new SnapshotMirror();
  const truth = new MirrorTruth();
  return {
    mirror,
    advance: () => {
      const delta = deltas.next();
      if (delta === null) return;
      mirror.apply(delta);
      expect(truth.check(delta, mirror.snapshot())).toBeNull();
    },
  };
}

/** Scenes whose runs exercise the grouped bonds: families, building sites, shelters and drills. */
const SCENES = ['family', 'construction', 'ai-defence', 'school', 'household-goods'] as const;
const RUN_TICKS = 240;

/** The same entity objects under a new snapshot object, so its indexes are built by one walk. */
function walkedCopy(snapshot: WorldSnapshot): WorldSnapshot {
  return { tick: snapshot.tick, entities: [...snapshot.entities], events: [] };
}

const ids = (list: readonly SnapshotEntity[]): number[] => list.map((e) => e.id);

function expectReadersMatchWalk(live: WorldSnapshot): void {
  const walked = walkedCopy(live);
  expect(ids(actorsOf(live))).toEqual(ids(actorsOf(walked)));
  expect(actorsOf(live).every((e, i) => e === actorsOf(walked)[i])).toBe(true);
  expect(needsRuleEnabled(live)).toBe(needsRuleEnabled(walked));
  for (const e of walked.entities) {
    expect(trainingOccupancyOf(live, e.id)).toBe(trainingOccupancyOf(walked, e.id));
    expect(builderCrewSize(live, e.id)).toBe(builderCrewSize(walked, e.id));
    expect(shelterClaimCount(live, e.id)).toBe(shelterClaimCount(walked, e.id));
    expect(ids(staffOf(live, e.id))).toEqual(ids(staffOf(walked, e.id)));
    expect(ids(siteCrewOf(live, e.id))).toEqual(ids(siteCrewOf(walked, e.id)));
    expect(ids(supplyRunsTo(live, e.id))).toEqual(ids(supplyRunsTo(walked, e.id)));
    expect(ids(shelterersOf(live, e.id))).toEqual(ids(shelterersOf(walked, e.id)));
    expect(homeFamiliesOf(live, e.id)).toEqual(homeFamiliesOf(walked, e.id));
    expect(ids(raisingCrew(live, e.id))).toEqual(ids(raisingCrew(walked, e.id)));
    expect(ids(shelteringIn(live, e.id))).toEqual(ids(shelteringIn(walked, e.id)));
    if (!isSettler(e)) continue;
    expect(surnameSourceOf(live, e)).toBe(surnameSourceOf(walked, e));
    expect(progressionGatesSettler(live, e)).toBe(progressionGatesSettler(walked, e));
    expect(ownedByComputerSeat(live, e)).toBe(ownedByComputerSeat(walked, e));
  }
}

describe('snapshot readers over a mirror', () => {
  it.each(SCENES)('equal a fresh walk after every delta of the %s scene', (id) => {
    const scene = getScene(id);
    if (scene === undefined) throw new Error(`scene ${id} missing`);
    const sim = createSceneSim(scene);
    const { mirror, advance } = checkedMirror(sim);
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      sim.step();
      advance();
      expectReadersMatchWalk(mirror.snapshot());
      expect(mirror.verifyIndexes()).toEqual([]);
    }
  });
});

/** Scenes whose runs raise the projected marks: bubbles, wounds and stock hearts, sites, staff and homes. */
const PROJECTION_SCENES = ['family', 'battle-weary', 'livestock', 'construction', 'ai-defence'] as const;
/** Every how-many-th settler of the list stands selected, so selected people join the heart candidates. */
const SELECTED_STRIDE = 5;

const noDoorInfo = (): undefined => undefined;

/** A selection in descending id order, so the heart merge cannot lean on the set's insertion order. */
function everyFewSettlers(snapshot: WorldSnapshot): ReadonlySet<number> {
  const settlers = snapshot.entities.filter(isSettler);
  const picked = settlers.filter((_, i) => i % SELECTED_STRIDE === 0).map((e) => e.id);
  return new Set(picked.reverse());
}

function expectProjectionsMatchWalk(live: WorldSnapshot, hearts: LifeHeartInputs): void {
  const walked = walkedCopy(live);
  expect(computeSettlerBubbles(live)).toEqual(computeSettlerBubbles(walked));
  expect(computeLifeHearts(live, hearts)).toEqual(computeLifeHearts(walked, hearts));
  expect(computeConstructionSigns(live, noDoorInfo)).toEqual(computeConstructionSigns(walked, noDoorInfo));
  expect(computeDoorBadges(live, noDoorInfo, workerRoleOf)).toEqual(
    computeDoorBadges(walked, noDoorInfo, workerRoleOf),
  );
}

describe('per-tick projections over a mirror', () => {
  it.each(PROJECTION_SCENES)('equal a fresh walk after every delta of the %s scene', (id) => {
    const scene = getScene(id);
    if (scene === undefined) throw new Error(`scene ${id} missing`);
    const sim = createSceneSim(scene);
    const { mirror, advance } = checkedMirror(sim);
    const isLivestockTribe = (tribe: number): boolean => systems.isCatchableAnimal(sim.content, tribe);
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      sim.step();
      advance();
      const live = mirror.snapshot();
      expectProjectionsMatchWalk(live, { isLivestockTribe, selected: everyFewSettlers(live) });
      expect(mirror.verifyIndexes()).toEqual([]);
    }
  });
});
