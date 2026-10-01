import type { ContentSet } from '@open-northland/data';
import type { EntitySnapshot } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JOB_CHILD_MALE,
  JOB_CIVILIST,
  JOB_COLLECTOR,
  JOB_HERO_UNARMED,
  JOB_SCOUT,
  JOB_SOLDIER,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import { HUMAN_PLAYER, PRIMARY_TRIBE } from '../src/game/rules.js';
import {
  BUILDING_HEADQUARTERS,
  BUILDING_WAREHOUSE_00,
  BUILDING_WAREHOUSE_01,
  BUILDING_WATCHTOWER,
} from '../src/game/sandbox/ids/index.js';
import { createSceneSim } from '../src/scenes/index.js';
import { sandboxScene } from '../src/scenes/sandbox/index.js';
import {
  globalDefenceOrders,
  selectionKeyEffect,
  storeJumpTargets,
} from '../src/view/unit-controls/keyboard-picks.js';
import { buildingEntity, snapshotOf } from './support/sandbox.js';

const RIVAL_PLAYER = 1;
const FEMALE = { Female: { female: true } };

function person(
  id: number,
  jobType: number,
  components: Readonly<Record<string, unknown>> = {},
  player = HUMAN_PLAYER,
): EntitySnapshot {
  return {
    id,
    components: {
      Settler: { tribe: PRIMARY_TRIBE, jobType },
      Person: { person: true },
      Owner: { player },
      ...components,
    },
  };
}

/** The sandbox content plus the hero row its job table lacks. */
function sandboxContent(): ContentSet {
  const content = createSceneSim(sandboxScene).content;
  return {
    ...content,
    jobs: [
      ...content.jobs,
      { typeId: JOB_HERO_UNARMED, id: 'hero_unarmed', allowedAtomics: [], forbiddenAtomics: [] },
    ],
  };
}

const content = sandboxContent();

const people = snapshotOf([
  person(2, JOB_CIVILIST),
  person(3, JOB_COLLECTOR),
  person(4, JOB_CIVILIST, {}, RIVAL_PLAYER),
  person(5, JOB_CIVILIST),
  person(6, JOB_SOLDIER),
  person(7, JOB_HERO_UNARMED),
  person(8, JOB_SCOUT),
  person(9, JOB_SOLDIER),
  person(10, JOB_WOMAN, { ...FEMALE, Residence: { home: 1 } }),
  person(11, JOB_WOMAN, FEMALE),
  person(12, JOB_WOMAN, { ...FEMALE, Marriage: { spouse: 2, child: null } }),
  person(13, JOB_CHILD_MALE, { Age: { ticks: 0 } }),
  person(14, JOB_CIVILIST, { TrainingOrder: { house: 1, drillTicksLeft: 10 } }),
]);

const effect = (action: Parameters<typeof selectionKeyEffect>[0], selected: readonly number[] = []) =>
  selectionKeyEffect(action, people, content, HUMAN_PLAYER, new Set(selected));

describe('selection keys', () => {
  it('step to the next own civilian after the selected one, wrapping, and centre on it', () => {
    expect(effect('nextCivilian')).toEqual({ ids: [2], add: false, centre: 2 });
    expect(effect('nextCivilian', [2])).toEqual({ ids: [5], add: false, centre: 5 });
    expect(effect('nextCivilian', [5])).toEqual({ ids: [2], add: false, centre: 2 });
    expect(effect('nextScout', [3])?.ids).toEqual([8]);
  });

  it('skip a civilian already sent to a school or barracks', () => {
    expect(effect('nextCivilian', [5])?.ids).toEqual([2]);
    expect(effect('nextCivilian', [14])?.ids).toEqual([2]);
  });

  it('take the unmarried woman without a home for the single-woman key', () => {
    expect(effect('nextSingleWoman')?.ids).toEqual([11]);
    expect(effect('nextSingleWoman', [11])?.ids).toEqual([11]);
  });

  it('select or add every own soldier and select every hero, whole map', () => {
    expect(effect('selectSoldiers')).toEqual({ ids: [6, 9], add: false, centre: null });
    expect(effect('addSoldiers', [2])).toEqual({ ids: [6, 9], add: true, centre: null });
    expect(effect('selectHeroes')).toEqual({ ids: [7], add: false, centre: null });
  });

  it('narrow the selection to its heroes or soldiers, and change nothing when it already is', () => {
    expect(effect('keepHeroes', [2, 6, 7])).toEqual({ ids: [7], add: false, centre: null });
    expect(effect('keepSoldiers', [2, 6, 7])).toEqual({ ids: [6], add: false, centre: null });
    expect(effect('keepSoldiers', [6, 9])).toBeNull();
  });

  it('leave the selection alone when nobody fits', () => {
    const empty = snapshotOf([person(2, JOB_COLLECTOR)]);
    expect(selectionKeyEffect('selectHeroes', empty, content, HUMAN_PLAYER, new Set([2]))).toBeNull();
    expect(selectionKeyEffect('nextCivilian', empty, content, HUMAN_PLAYER, new Set())).toBeNull();
  });
});

describe('store jump targets', () => {
  it('list the own headquarters first, then the standing warehouses by id', () => {
    const snapshot = snapshotOf([
      buildingEntity(1, BUILDING_WAREHOUSE_01),
      buildingEntity(2, BUILDING_WATCHTOWER),
      buildingEntity(3, BUILDING_WAREHOUSE_00),
      buildingEntity(4, BUILDING_HEADQUARTERS),
      buildingEntity(5, BUILDING_HEADQUARTERS, { components: { Owner: { player: RIVAL_PLAYER } } }),
      buildingEntity(6, BUILDING_WAREHOUSE_00, { components: { UnderConstruction: {} } }),
    ]);
    expect(storeJumpTargets(snapshot, content, HUMAN_PLAYER)).toEqual([4, 1, 3]);
  });
});

describe('global defence orders', () => {
  const snapshot = snapshotOf([
    buildingEntity(1, BUILDING_HEADQUARTERS),
    buildingEntity(2, BUILDING_WATCHTOWER, { components: { DefenceMode: {} } }),
    buildingEntity(3, BUILDING_WATCHTOWER, { components: { UnderConstruction: {} } }),
    buildingEntity(4, BUILDING_WAREHOUSE_00),
    buildingEntity(5, BUILDING_WATCHTOWER, { components: { Owner: { player: RIVAL_PLAYER } } }),
  ]);

  it('raise the mode on every own finished defence building still without it', () => {
    expect(globalDefenceOrders(snapshot, content, HUMAN_PLAYER, true)).toEqual([
      { kind: 'setDefenceMode', building: 1, enabled: true },
    ]);
  });

  it('lower it only where it is up', () => {
    expect(globalDefenceOrders(snapshot, content, HUMAN_PLAYER, false)).toEqual([
      { kind: 'setDefenceMode', building: 2, enabled: false },
    ]);
  });
});
