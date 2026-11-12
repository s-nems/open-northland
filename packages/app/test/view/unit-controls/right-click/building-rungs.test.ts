import { ONE, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JOB_ARCHER,
  JOB_BUILDER,
  JOB_COLLECTOR,
  JOB_SOLDIER_SWORD,
  JOB_SOLDIER_UNARMED,
} from '../../../../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../../../../src/game/rules.js';
import { BUILDING_BARRACKS, BUILDING_HOME_00, sandboxContent } from '../../../../src/game/sandbox/index.js';
import type { FormationUnit } from '../../../../src/view/unit-controls/orders/formation.js';
import {
  atBuilding,
  atSite,
  queueAtBuilding,
} from '../../../../src/view/unit-controls/right-click/building-rungs.js';
import { type Ent, snapshotOf } from '../../../support/snapshot.js';

/** The ladder's building rungs: who joins a building's crew, who it houses, drills or teaches, and who
 *  a site pins. */

const CONTENT = sandboxContent();
const SCHOOL = ((): number => {
  const school = CONTENT.buildings.find((row) => systems.isSchoolType(row));
  if (school === undefined) throw new Error('the sandbox has no school');
  return school.typeId;
})();
const BUILDING = 100;
const SITE = 101;
const TILE = { col: 6, row: 8 };
const FIRST_SETTLER = 1;
/** A builder of the selection already pinned to `BUILDING`, so its repair crew counts him. */
const PINNED = 50;

type BuildingState = 'foundation' | 'damaged' | 'standing';

const settler = (id: number, jobType: number | null, site?: number, fightPoints = 0): Ent => ({
  id,
  components: {
    Settler: { tribe: PRIMARY_TRIBE, jobType },
    SettlerProgress: { experience: [[systems.FIGHT_EXPERIENCE_TYPE.PERSONAL, fightPoints]] },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: ONE, y: ONE },
    ...(site === undefined ? {} : { SiteAssignment: { site } }),
  },
});

const COIN = ((): number => {
  const coin = systems.drillCoinGood(CONTENT);
  if (coin === undefined) throw new Error('the sandbox has no drill coin');
  return coin;
})();
/** More coins on a barracks' shelf than any test sends men. */
const PLENTY_OF_COINS = 10;

const building = (buildingType: number, state: BuildingState, coins = PLENTY_OF_COINS): Ent => ({
  id: BUILDING,
  components: {
    Stockpile: { amounts: [[COIN, coins]] },
    Building: { buildingType, tribe: 1, built: state === 'foundation' ? 0 : ONE, level: 0 },
    Owner: { player: HUMAN_PLAYER },
    Position: { x: 4 * ONE, y: 4 * ONE },
    ...(state === 'foundation' ? { UnderConstruction: { labor: 0 } } : {}),
    ...(state === 'damaged' ? { Damaged: { lastHitTick: 0 } } : {}),
  },
});

const units = (count: number, from = FIRST_SETTLER): FormationUnit[] =>
  Array.from({ length: count }, (_, i) => ({ ref: from + i, x: 0, y: 0 }));

const refs = (list: readonly FormationUnit[]): number[] => list.map((unit) => unit.ref);

function contextOf(entities: readonly Ent[]) {
  return { snapshot: snapshotOf(entities), content: CONTENT };
}

describe('the building rungs', () => {
  it('take every builder into a foundation, a damaged building only while its repair crew has room', () => {
    const builders = units(systems.REPAIR_CREW_LIMIT + 1);
    const crewOf = (state: BuildingState, extra: readonly Ent[] = []) => {
      const ctx = contextOf([
        ...builders.map((unit) => settler(unit.ref, JOB_BUILDER)),
        ...extra,
        building(BUILDING_HOME_00, state),
      ]);
      const intent = atBuilding(ctx, builders, BUILDING);
      if (intent.kind !== 'building') throw new Error(`not a building rung: ${intent.kind}`);
      return refs(intent.crew);
    };
    expect(crewOf('foundation')).toEqual(refs(builders));
    expect(crewOf('damaged')).toEqual(refs(builders.slice(0, systems.REPAIR_CREW_LIMIT)));
    // One builder of another selection already mends it: one seat less.
    expect(crewOf('damaged', [settler(PINNED, JOB_BUILDER, BUILDING)])).toHaveLength(
      systems.REPAIR_CREW_LIMIT - 1,
    );
    expect(crewOf('standing')).toEqual([]);
  });

  it('house the rest at a home, drill them at a barracks and offer them the lessons at a school', () => {
    const [builder, idle] = units(2);
    if (builder === undefined || idle === undefined) throw new Error('setup: two settlers');
    const at = (buildingType: number) =>
      atBuilding(
        contextOf([
          settler(builder.ref, JOB_BUILDER),
          settler(idle.ref, null),
          building(buildingType, 'foundation'),
        ]),
        [builder, idle],
        BUILDING,
      );
    expect(at(BUILDING_HOME_00)).toMatchObject({ kind: 'building', crew: [builder], household: [idle] });
    expect(at(BUILDING_BARRACKS)).toMatchObject({ kind: 'building', crew: [builder], trainees: [idle] });
    expect(at(SCHOOL)).toEqual({ kind: 'school', building: BUILDING, crew: [builder], learners: [idle] });
  });

  it('drill the armed soldiers below the limit for coins at a standing barracks and enlist the rest', () => {
    const [sword, archer, bare, veteran] = units(4);
    if (sword === undefined || archer === undefined || bare === undefined || veteran === undefined)
      throw new Error('setup: four soldiers');
    const at = (state: BuildingState, coins?: number) =>
      atBuilding(
        contextOf([
          settler(sword.ref, JOB_SOLDIER_SWORD),
          settler(archer.ref, JOB_ARCHER, undefined, systems.COIN_DRILL_LIMIT - 1),
          settler(bare.ref, JOB_SOLDIER_UNARMED),
          settler(veteran.ref, JOB_SOLDIER_SWORD, undefined, systems.COIN_DRILL_LIMIT),
          building(BUILDING_BARRACKS, state, coins),
        ]),
        [sword, archer, bare, veteran],
        BUILDING,
      );
    expect(at('standing')).toMatchObject({ drillers: [sword, archer], trainees: [bare, veteran] });
    // A foundation, or a barracks with no coin, drills nobody: its recruits go as they would to enlist.
    expect(at('foundation')).toMatchObject({ drillers: [], trainees: [sword, archer, bare, veteran] });
    expect(at('standing', 0)).toMatchObject({ drillers: [], trainees: [sword, archer, bare, veteran] });
  });

  it('send the drillers nearest to the barracks first, then by id, as many as it shows coins', () => {
    const [far, near, tied] = units(3);
    if (far === undefined || near === undefined || tied === undefined)
      throw new Error('setup: three soldiers');
    const placed = (unit: FormationUnit, x: number): Ent => {
      const ent = settler(unit.ref, JOB_SOLDIER_SWORD);
      return { ...ent, components: { ...ent.components, Position: { x: x * ONE, y: 4 * ONE } } };
    };
    const intent = atBuilding(
      contextOf([
        placed(far, 12),
        placed(near, 6),
        placed(tied, 6),
        building(BUILDING_BARRACKS, 'standing', [near, tied].length),
      ]),
      [far, tied, near],
      BUILDING,
    );
    expect(intent).toMatchObject({ drillers: [near, tied], trainees: [] });
  });

  it('queue the crew and the recruits under Shift and walk the rest there', () => {
    const [builder, idle, collector] = units(3);
    if (builder === undefined || idle === undefined || collector === undefined)
      throw new Error('setup: three settlers');
    const ctx = contextOf([
      settler(builder.ref, JOB_BUILDER),
      settler(idle.ref, null),
      settler(collector.ref, JOB_COLLECTOR),
      building(BUILDING_BARRACKS, 'foundation'),
    ]);
    expect(queueAtBuilding(ctx, [builder, idle, collector], BUILDING, TILE)).toEqual({
      kind: 'queueAtBuilding',
      building: BUILDING,
      crew: [builder],
      recruits: [idle, collector],
      walkers: [],
      tile: TILE,
    });
    const home = contextOf([
      settler(builder.ref, JOB_BUILDER),
      settler(idle.ref, null),
      building(BUILDING_HOME_00, 'foundation'),
    ]);
    expect(queueAtBuilding(home, [builder, idle], BUILDING, TILE)).toMatchObject({
      crew: [builder],
      recruits: [],
      walkers: [idle],
    });
  });

  it('pin the builders to a wall or road site and walk the rest there', () => {
    const [builder, idle] = units(2);
    if (builder === undefined || idle === undefined) throw new Error('setup: two settlers');
    const ctx = contextOf([settler(builder.ref, JOB_BUILDER), settler(idle.ref, null)]);
    expect(atSite(ctx, [builder, idle], SITE, TILE)).toEqual({
      kind: 'site',
      site: SITE,
      builders: [builder],
      walkers: [idle],
      tile: TILE,
    });
  });
});
