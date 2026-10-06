import {
  bucketsReach,
  indexesOf,
  MirrorTruth,
  nodeOfPosition,
  ONE,
  type Simulation,
  SnapshotMirror,
  systems,
  type TileBox,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { workerRoleOf } from '../src/game/sandbox/worker-roles.js';
import {
  actorsOf,
  builderCrewSize,
  buildingTypeOf,
  homeFamiliesOf,
  isBuilding,
  isSettler,
  needsRuleEnabled,
  ownedByComputerSeat,
  ownerPlayerOf,
  positionOf,
  progressionGatesSettler,
  type SnapshotEntity,
  settlersOwnedBy,
  shelterClaimCount,
  shelterersOf,
  siteCrewOf,
  staffOf,
  supplyRunsTo,
  trainingOccupancyOf,
} from '../src/game/snapshot.js';
import { entitiesUnder, idsGroupedBy, idsWhere } from '../src/game/snapshot-id-index.js';
import { buildingPeersOf, ownedBuildingsOfType } from '../src/hud/details-panel/model/building.js';
import { raisingCrew, shelteringIn } from '../src/hud/details-panel/model/building-staff.js';
import { forEachMinimapDot, type MinimapDotContext } from '../src/hud/minimap/dots.js';
import { DEFAULT_MINIMAP_FILTERS, withAllMinimapLayers } from '../src/hud/minimap/filters.js';
import { restingBuildingsOf } from '../src/hud/tool-panel/messages/workshop-stalls.js';
import { createSceneSim, getScene } from '../src/scenes/index.js';
import { computeConstructionSigns } from '../src/view/projections/construction-signs.js';
import { computeDoorBadges, type DoorBadgeCache } from '../src/view/projections/door-badges.js';
import { computeLifeHearts, type LifeHeartInputs } from '../src/view/projections/life-hearts.js';
import { computeSettlerBubbles } from '../src/view/projections/settler-bubbles.js';
import { ownRoadSiteAt } from '../src/view/runtime/own-road-sites.js';
import { builderSitesOf } from '../src/view/unit-controls/highlights/own-building-picks.js';

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

/** Scenes whose runs exercise the grouped bonds: families, building sites, shelters, drills and roads. */
const SCENES = ['family', 'construction', 'ai-defence', 'school', 'household-goods', 'roads'] as const;
/** The seats whose per-owner readers each check compares. */
const SEATS = [0, 1, 2, 3] as const;
/** A key no entity sits under: an unowned or untyped building reads the empty group. */
const NO_KEY = -1;
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
  for (const seat of SEATS) {
    expect(ids(settlersOwnedBy(live, seat))).toEqual(ids(settlersOwnedBy(walked, seat)));
    expect(ids(builderSitesOf(live, seat))).toEqual(ids(builderSitesOf(walked, seat)));
  }
  for (const e of walked.entities) {
    if (isBuilding(e)) {
      const owner = ownerPlayerOf(e) ?? NO_KEY;
      const type = buildingTypeOf(e) ?? NO_KEY;
      expect(buildingPeersOf(live, e)).toEqual(buildingPeersOf(walked, e));
      expect(ids(ownedBuildingsOfType(live, owner, type))).toEqual(
        ids(ownedBuildingsOfType(walked, owner, type)),
      );
      expect(ids(restingBuildingsOf(live, owner, type))).toEqual(
        ids(restingBuildingsOf(walked, owner, type)),
      );
    }
    const at = e.components.RoadSite === undefined ? undefined : positionOf(e);
    if (at !== undefined) {
      const { hx, hy } = nodeOfPosition(at.x, at.y);
      for (const seat of SEATS)
        expect(ownRoadSiteAt(live, seat, hx, hy)).toBe(ownRoadSiteAt(walked, seat, hx, hy));
    }
  }
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

/** Every layer for seat 0, with odd seats hostile, so each marker group stamps. */
const MINIMAP_CONTEXT: MinimapDotContext = {
  fog: null,
  bounds: { minX: 0, minY: 0, width: 1, height: 1 },
  scale: 1,
  filters: withAllMinimapLayers(DEFAULT_MINIMAP_FILTERS, true),
  isFighterJob: () => false,
  viewer: 0,
  stanceToward: (owner) => (owner % 2 === 1 ? 'enemy' : 'friend'),
};

function minimapMarks(snapshot: WorldSnapshot): unknown[] {
  const marks: unknown[] = [];
  forEachMinimapDot(snapshot, MINIMAP_CONTEXT, (x, y, mark, colour, part) =>
    marks.push([x, y, mark, colour, part]),
  );
  return marks;
}

/** The western half of the positioned entities' extent, so a box query has units on both sides of it. */
function westernHalf(snapshot: WorldSnapshot): TileBox {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const e of snapshot.entities) {
    const pos = positionOf(e);
    if (pos === undefined) continue;
    minX = Math.min(minX, pos.x / ONE);
    maxX = Math.max(maxX, pos.x / ONE);
  }
  return { minX, minY: Number.MIN_SAFE_INTEGER, maxX: (minX + maxX) / 2, maxY: Number.MAX_SAFE_INTEGER };
}

/** What a box query returns: the units whose position the box's buckets reach. */
function reachedBy(snapshot: WorldSnapshot, box: TileBox): Set<number> {
  const ids = new Set<number>();
  for (const e of snapshot.entities) {
    const pos = positionOf(e);
    if (pos !== undefined && bucketsReach(box, pos.x / ONE, pos.y / ONE)) ids.add(e.id);
  }
  return ids;
}

function expectProjectionsMatchWalk(
  live: WorldSnapshot,
  hearts: LifeHeartInputs,
  badges: DoorBadgeCache,
): void {
  const walked = walkedCopy(live);
  const box = westernHalf(live);
  const reached = reachedBy(walked, box);
  expect(computeLifeHearts(live, hearts, box)).toEqual(
    computeLifeHearts(walked, hearts).filter((heart) => reached.has(heart.id)),
  );
  expect(computeDoorBadges(live, noDoorInfo, workerRoleOf, box, badges)).toEqual(
    computeDoorBadges(walked, noDoorInfo, workerRoleOf).filter((badge) => reached.has(badge.id)),
  );
  expect(minimapMarks(live)).toEqual(minimapMarks(walked));
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
    const badges: DoorBadgeCache = { held: new Map() };
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      sim.step();
      advance();
      const live = mirror.snapshot();
      expectProjectionsMatchWalk(live, { isLivestockTribe, selected: everyFewSettlers(live) }, badges);
      expect(mirror.verifyIndexes()).toEqual([]);
    }
  });
});

describe('id indexes', () => {
  const OWNED = idsGroupedBy(ownerPlayerOf, 'test settlers by owner', { values: ['Owner'] });
  const SETTLERS = idsWhere(isSettler, 'test settlers', { presence: ['Settler'] });

  it('answer the current entity objects after their members move', () => {
    const scene = getScene('family');
    if (scene === undefined) throw new Error('scene family missing');
    const sim = createSceneSim(scene);
    const { mirror, advance } = checkedMirror(sim);
    advance();
    const settler = mirror.snapshot().entities.find(isSettler);
    if (settler === undefined) throw new Error('the family scene fields no settler');
    const owner = ownerPlayerOf(settler) ?? NO_KEY;
    entitiesUnder(mirror.snapshot(), OWNED, owner);
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      sim.step();
      advance();
    }
    const live = mirror.snapshot();
    const current = live.entities.filter((e) => ownerPlayerOf(e) === owner);
    expect(entitiesUnder(live, OWNED, owner)).toEqual(current);
    expect(entitiesUnder(live, OWNED, owner).every((e, i) => e === current[i])).toBe(true);
    expect(mirror.verifyIndexes()).toEqual([]);
  });

  it('report a corrupted grouping or list against a fresh walk', () => {
    const scene = getScene('family');
    if (scene === undefined) throw new Error('scene family missing');
    const sim = createSceneSim(scene);
    const { mirror, advance } = checkedMirror(sim);
    advance();
    const indexes = indexesOf(mirror.snapshot());
    const groups = indexes.get(OWNED);
    const settlers = indexes.get(SETTLERS);
    sim.step();
    advance();
    expect(mirror.verifyIndexes()).toEqual([]);
    const member = [...groups.values()][0]?.[0];
    if (member === undefined) throw new Error('the family scene owns nothing');
    groups.keyOfId.delete(member);
    settlers.pop();
    expect(mirror.verifyIndexes()).toEqual([
      expect.stringContaining('test settlers by owner'),
      expect.stringContaining('test settlers index'),
    ]);
  });
});
