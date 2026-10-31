import { describe, expect, it } from 'vitest';
import { ATTACK_ATOMIC, SLEEP_ATOMIC } from '../../../src/catalog/atomics.js';
import type { ContentIr } from '../../../src/content/ir/rows.js';
import { filmBobs, filmStepMs, knowledgeFilm } from '../../../src/hud/knowledge/film.js';

const TRIBE = 2;
const CIVILIST = 6;
const SMITH = 13;
const SMITH_ACTION = 60;
const SEQ_START = 100;
const FACINGS = 8;
const SE_DIR = 1;
const BLOCK = 4;

/** Eight blocks, each list inside its own: direction `d` plays `d * BLOCK..`. */
const dirLists = Array.from({ length: FACINGS }, (_, dir) =>
  Array.from({ length: BLOCK }, (_, step) => dir * BLOCK + step),
);

function smithIr(): ContentIr {
  return {
    jobs: [
      { typeId: CIVILIST, id: 'civilist' },
      { typeId: SMITH, id: 'smith', baseJob: CIVILIST },
    ],
    jobGraphics: [
      {
        tribe: TRIBE,
        job: CIVILIST,
        body: 'bobs/cr_hum_body_30.bmd',
        heads: ['bobs/cr_hum_head_30.bmd'],
        randomPalettes: [],
      },
    ],
    bobSequences: [
      {
        imagelib: 'cr_hum_body_30.bmd',
        sequences: [
          { name: 'fight', start: SEQ_START, length: BLOCK * FACINGS },
          { name: 'anvil', start: SEQ_START * 2, length: BLOCK },
        ],
      },
    ],
    gfxAtomics: [
      { tribe: TRIBE, job: CIVILIST, action: SLEEP_ATOMIC, bodySeq: 'anvil', dirFrames: [[0, 1]] },
      { tribe: TRIBE, job: CIVILIST, action: ATTACK_ATOMIC, bodySeq: 'fight', dirFrames: dirLists },
      { tribe: TRIBE, job: SMITH, action: SMITH_ACTION, subId: 1, bodySeq: 'anvil', dirFrames: [[3, 2, 1]] },
    ],
  } as unknown as ContentIr;
}

describe('filmBobs', () => {
  it('reads a frame list at the facing, and a lone list on every facing', () => {
    expect(filmBobs({ start: 10, frameLists: [[1], [2, 3]] }, 1)).toEqual([12, 13]);
    expect(filmBobs({ start: 10, frameLists: [[4, 5]] }, 3)).toEqual([14, 15]);
  });

  it('walks a strip block inside its facing, not across the facings', () => {
    expect(filmBobs({ start: 10, dirs: FACINGS, stride: 3 }, 2)).toEqual([16, 17, 18]);
  });
});

describe('filmStepMs', () => {
  it('stretches a clip over its bound length, else a step lasts a tick', () => {
    expect(filmStepMs(12, 24)).toBeCloseTo(2 * filmStepMs(12, undefined));
  });
});

describe('knowledgeFilm', () => {
  it('plays the record at the south-east view, whose source direction is not its list index', () => {
    const film = knowledgeFilm(smithIr(), undefined, {
      kind: 'job',
      jobType: SMITH,
      tribe: TRIBE,
      action: 'attack',
    });
    const offset = SE_DIR * BLOCK;
    expect(film?.layers[0]?.bobs).toEqual([0, 1, 2, 3].map((step) => SEQ_START + offset + step));
    expect(film?.layers[0]?.stems[0]).toBe('cr_hum_body_30.test_human_00');
    expect(film?.layers[1]?.stems[0]).toBe('cr_hum_head_30.test_human_00');
  });

  it("takes a worker's own trade, not the daily life he inherits", () => {
    const film = knowledgeFilm(smithIr(), undefined, {
      kind: 'job',
      jobType: SMITH,
      tribe: TRIBE,
      action: 'work',
    });
    expect(film?.layers[0]?.bobs).toEqual([203, 202, 201]);
  });

  it('gives a job with no trade or no record no film', () => {
    const ir = smithIr();
    expect(
      knowledgeFilm(ir, undefined, { kind: 'job', jobType: CIVILIST, tribe: TRIBE, action: 'work' }),
    ).toBeNull();
    expect(
      knowledgeFilm(ir, undefined, { kind: 'job', jobType: SMITH, tribe: TRIBE, action: 'walk' }),
    ).toBeNull();
    expect(knowledgeFilm(ir, undefined, { kind: 'animal', animalTribe: 999, action: 'walk' })).toBeNull();
  });
});
