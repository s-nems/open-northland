import type { HudModel, JobCount, StockCount } from '@open-northland/render';
import { TICKS_PER_SECOND } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import {
  JOB_BABY_FEMALE,
  JOB_BABY_MALE,
  JOB_CHILD_FEMALE,
  JOB_CHILD_MALE,
  JOB_CIVILIST,
  JOB_HERO_SWORD,
  JOB_HEROINE_BOW,
  JOB_IDLE,
  JOB_SOLDIER_SWORD,
  JOB_WOMAN,
} from '../src/catalog/jobs.js';
import {
  formatSimClock,
  SUMMARY_CATEGORIES,
  summaryPopulation,
  summaryStocks,
} from '../src/hud/summary/model.js';

const WOODCUTTER = 8;
const LOCAL = 0;

/** Good type ids for the string ids under test; the real numbering is the content set's. */
const TYPE_BY_ID = new Map<string, number>([
  ['wood', 5],
  ['stone', 3],
  ['wheat', 4],
  ['mead', 43],
  ['sword_shord', 41],
  ['shoes', 30],
  ['coin', 8],
  ['amulet_speed', 55],
  ['honey', 12],
  ['bread', 19],
]);
const ID_BY_TYPE = new Map([...TYPE_BY_ID].map(([id, type]) => [type, id] as const));
const goodIdOf = (goodType: number): string | undefined => ID_BY_TYPE.get(goodType);
const typeOf = (goodId: string): number => {
  const type = TYPE_BY_ID.get(goodId);
  if (type === undefined) throw new Error(`no type for ${goodId}`);
  return type;
};

function model(jobs: readonly JobCount[], stocks: readonly StockCount[] = [], tick = 0): HudModel {
  return {
    tick,
    player: LOCAL,
    population: jobs.reduce((sum, job) => sum + job.count, 0),
    jobs,
    stocks,
  };
}

describe('summaryPopulation', () => {
  it('splits adults by the Female tally, men by the army band, and children by sex', () => {
    const out = summaryPopulation(
      model([
        { jobType: JOB_BABY_FEMALE, count: 1, female: 1 },
        { jobType: JOB_BABY_MALE, count: 1, female: 0 },
        { jobType: JOB_CHILD_FEMALE, count: 2, female: 2 },
        { jobType: JOB_CHILD_MALE, count: 1, female: 0 },
        { jobType: JOB_WOMAN, count: 3, female: 3 },
        { jobType: JOB_CIVILIST, count: 2, female: 0 },
        { jobType: WOODCUTTER, count: 4, female: 1 }, // a woman in a trade stays a woman
        { jobType: JOB_IDLE, count: 1, female: 0 }, // an idle man is a worker without work
        { jobType: JOB_SOLDIER_SWORD, count: 2, female: 0 },
        { jobType: JOB_HERO_SWORD, count: 1, female: 0 },
        { jobType: JOB_HEROINE_BOW, count: 1, female: 1 }, // a heroine is a woman, not a soldier
      ]),
    );
    expect(out).toEqual({
      women: 5,
      men: 9,
      soldiers: 3,
      workers: 6,
      children: 5,
      girls: 3,
      boys: 2,
      total: 19,
    });
  });

  it('reads all zeros off an empty seat', () => {
    expect(summaryPopulation(model([]))).toEqual({
      women: 0,
      men: 0,
      soldiers: 0,
      workers: 0,
      children: 0,
      girls: 0,
      boys: 0,
      total: 0,
    });
  });
});

describe('summaryStocks', () => {
  it('lists every catalogued row in its fixed order, zeros included, and totals each category', () => {
    const out = summaryStocks(
      model(
        [],
        [
          { goodType: typeOf('stone'), amount: 18 },
          { goodType: typeOf('wood'), amount: 42 },
          { goodType: typeOf('wheat'), amount: 12 },
          { goodType: typeOf('mead'), amount: 3 },
          { goodType: typeOf('sword_shord'), amount: 2 },
        ],
      ),
      goodIdOf,
    );
    expect(out.map((category) => [category.id, category.total])).toEqual([
      ['food', 15],
      ['materials', 60],
      ['armament', 2],
      ['equipment', 0],
      ['other', 0],
    ]);
    const materials = out[1];
    expect(materials?.columns.map((column) => column.map((row) => row.goodId))).toEqual(
      SUMMARY_CATEGORIES[1]?.columns,
    );
    expect(materials?.columns[0]?.slice(0, 3)).toEqual([
      { goodId: 'wood', amount: 42 },
      { goodId: 'stone', amount: 18 },
      { goodId: 'mud', amount: 0 },
    ]);
    const equipment = out[3];
    expect(equipment?.columns[0]?.every((row) => row.amount === 0)).toBe(true);
    expect(equipment?.columns[0]?.map((row) => row.goodId)).toContain('shoes');
  });

  it('appends a stocked good outside every list to the shorter "other" column and counts it there', () => {
    const out = summaryStocks(
      model(
        [],
        [
          { goodType: typeOf('honey'), amount: 6 },
          { goodType: typeOf('bread'), amount: 1 },
          { goodType: typeOf('coin'), amount: 3 },
          { goodType: 999, amount: 5 }, // no catalog id: not a good
        ],
      ),
      goodIdOf,
    );
    const other = out[4];
    expect(other?.total).toBe(10);
    expect(other?.columns[1]?.slice(-2)).toEqual([
      { goodId: 'honey', amount: 6 },
      { goodId: 'bread', amount: 1 },
    ]);
    expect(other?.columns[0]?.some((row) => row.goodId === 'honey')).toBe(false);
    expect(
      out.flatMap((c) => c.columns.flat()).some((row) => row.goodId === 'bread' && row.amount === 0),
    ).toBe(false);
  });

  it('leaves an unlisted good with nothing on hand out entirely', () => {
    const out = summaryStocks(model([], [{ goodType: typeOf('honey'), amount: 0 }]), goodIdOf);
    expect(out[4]?.columns.flat().some((row) => row.goodId === 'honey')).toBe(false);
    expect(out[4]?.columns.map((column) => column.length)).toEqual(
      SUMMARY_CATEGORIES[4]?.columns.map((column) => column.length),
    );
  });
});

describe('formatSimClock', () => {
  it('prints elapsed sim time as h:mm:ss with the hour always shown', () => {
    expect(formatSimClock(0)).toBe('0:00:00');
    expect(formatSimClock(TICKS_PER_SECOND * (24 * 60 + 8))).toBe('0:24:08');
    expect(formatSimClock(TICKS_PER_SECOND * (3600 + 24 * 60 + 8))).toBe('1:24:08');
    expect(formatSimClock(TICKS_PER_SECOND * 3600 * 11)).toBe('11:00:00');
  });

  it('floors a partial second, so the reading never runs ahead of the sim', () => {
    expect(formatSimClock(TICKS_PER_SECOND * 5 - 1)).toBe('0:00:04');
  });
});
