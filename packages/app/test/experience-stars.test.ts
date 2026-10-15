import { fx, systems } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  computeExperienceStars,
  type ExperienceStarInputs,
  starTier,
} from '../src/view/projections/experience-stars.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const TRIBE = 1;
const PLAYER = 0;
const ENEMY = 1;
const SWORD_SOLDIER_JOB = 33;
const WOODCUTTER_JOB = 5;
const SWORD_CLASS = 3;
const SPEAR_CLASS = 2;
const SPEAR_GOOD = 40;
const WOOD_TRACK = 12;
const SWORD = systems.FIGHT_EXPERIENCE_TYPE.SWORD;

const RULES: Omit<ExperienceStarInputs, 'viewer' | 'selected'> = {
  isSoldierJob: (job) => job === SWORD_SOLDIER_JOB,
  weaponClassOf: (_tribe, job, good) =>
    good === SPEAR_GOOD ? SPEAR_CLASS : job === SWORD_SOLDIER_JOB ? SWORD_CLASS : undefined,
  tradeTracksOf: (job) => (job === WOODCUTTER_JOB ? [WOOD_TRACK] : []),
};

const human = (
  id: number,
  jobType: number,
  experience: [number, number][],
  extra: Record<string, unknown> = {},
  player = PLAYER,
): Ent => ({
  id,
  components: {
    Settler: { tribe: TRIBE, jobType },
    Owner: { player },
    Person: { person: true },
    Position: { x: fx.fromInt(id), y: fx.fromInt(1) },
    SettlerProgress: { experience },
    ...extra,
  },
});

const starsOf = (entities: Ent[], selected?: ReadonlySet<number>) =>
  computeExperienceStars(snapshotOf(entities), { ...RULES, viewer: PLAYER, selected });

describe('starTier', () => {
  it('shows from a quarter of the range and grows a size per quarter, capped at four', () => {
    expect([0, 24, 25, 49, 50, 75, 99, 100, 5000].map(starTier)).toEqual([0, 0, 1, 1, 2, 3, 3, 4, 4]);
  });
});

describe('computeExperienceStars - the weapon star', () => {
  it('a soldier of any owner wears it for the hits with the class he fights with', () => {
    expect(starsOf([human(1, SWORD_SOLDIER_JOB, [[SWORD, 60]], {}, ENEMY)])).toEqual([
      { id: 1, x: fx.fromInt(1), y: fx.fromInt(1), weaponTier: 2, jobTier: 0 },
    ]);
  });

  it('a worn weapon of another class reads that class, and too few hits wear none', () => {
    const spear = { Equipment: { weapon: { goodType: SPEAR_GOOD } } };
    expect(starsOf([human(1, SWORD_SOLDIER_JOB, [[SWORD, 100]], spear)])).toEqual([]);
    expect(starsOf([human(2, SWORD_SOLDIER_JOB, [[SWORD, 24]])])).toEqual([]);
  });

  it('a civilian never wears it, whatever he hit', () => {
    expect(starsOf([human(1, WOODCUTTER_JOB, [[SWORD, 100]])])).toEqual([]);
  });

  it('nobody indoors wears one', () => {
    expect(starsOf([human(1, SWORD_SOLDIER_JOB, [[SWORD, 100]], { Resting: { at: 9 } })])).toEqual([]);
  });
});

describe('computeExperienceStars - the trade star', () => {
  const MASTER_XP = 1_000_000;
  const woodcutter = (player = PLAYER) => human(1, WOODCUTTER_JOB, [[WOOD_TRACK, MASTER_XP]], {}, player);

  it('only the viewer’s own selected people wear it', () => {
    expect(starsOf([woodcutter()])).toEqual([]);
    expect(starsOf([woodcutter()], new Set([1]))[0]?.jobTier).toBe(4);
    expect(starsOf([woodcutter(ENEMY)], new Set([1]))).toEqual([]);
  });

  it('reads the selected inside a box as well as the indexed fighters', () => {
    const box = { minX: 0, minY: 0, maxX: 64, maxY: 64 };
    const snapshot = snapshotOf([woodcutter(), human(2, SWORD_SOLDIER_JOB, [[SWORD, 30]])]);
    const stars = computeExperienceStars(snapshot, { ...RULES, viewer: PLAYER, selected: new Set([1]) }, box);
    expect(stars.map((s) => [s.id, s.weaponTier, s.jobTier])).toEqual([
      [1, 0, 4],
      [2, 1, 0],
    ]);
  });
});
