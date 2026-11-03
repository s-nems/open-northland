import { IR_VERSION, parseContentSet } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { mergeContentModData, mergeContentModPatches } from '../../../src/content/mods/merge.js';

const BASE = parseContentSet({
  manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic' } },
  goods: [],
  jobs: [],
  buildings: [],
});

describe('content mod merge', () => {
  it('adds new keyed rows and merges matching rows without removing base content', () => {
    const merged = mergeContentModData(
      {
        goods: [
          { id: 'wood', name: 'Wood', gathering: { yieldPerNode: 2 } },
          { id: 'stone', name: 'Stone' },
        ],
      },
      {
        goods: [
          { id: 'wood', name: 'Oak', gathering: { depositSize: 10 } },
          { id: 'iron', name: 'Iron' },
        ],
      },
    );
    expect(merged).toEqual({
      goods: [
        { id: 'wood', name: 'Oak', gathering: { yieldPerNode: 2, depositSize: 10 } },
        { id: 'stone', name: 'Stone' },
        { id: 'iron', name: 'Iron' },
      ],
    });
  });

  it('merges job graphics by tribe and job while preserving other jobs in that tribe', () => {
    const merged = mergeContentModData(
      {
        jobGraphics: [
          { tribe: 1, job: 6, body: 'civilist.bmd' },
          { tribe: 1, job: 5, body: 'woman.bmd' },
        ],
      },
      { jobGraphics: [{ tribe: 1, job: 6, body: 'woman.bmd' }] },
    );
    expect(merged).toEqual({
      jobGraphics: [
        { tribe: 1, job: 6, body: 'woman.bmd' },
        { tribe: 1, job: 5, body: 'woman.bmd' },
      ],
    });
  });

  it('replaces nested building-cost arrays without replacing the building lane', () => {
    const merged = mergeContentModData(
      {
        buildings: [
          {
            typeId: 1,
            id: 'barracks',
            kind: 'training',
            construction: [
              { goodType: 2, amount: 4 },
              { goodType: 7, amount: 3 },
            ],
          },
          { typeId: 2, id: 'farm', kind: 'workplace', construction: [{ goodType: 2, amount: 8 }] },
        ],
        buildingBobs: [
          { tribeId: 1, typeId: 1, level: 0, paletteName: 'house01' },
          { tribeId: 1, typeId: 1, level: 0, paletteName: 'house02' },
        ],
      },
      {
        buildings: [
          { typeId: 1, id: 'barracks', kind: 'training', construction: [{ goodType: 2, amount: 1 }] },
        ],
        buildingBobs: [
          { tribeId: 1, typeId: 1, level: 0, paletteName: 'house01' },
          { tribeId: 1, typeId: 1, level: 0, paletteName: 'house02' },
        ],
      },
    );
    expect(merged).toEqual({
      buildings: [
        { typeId: 1, id: 'barracks', kind: 'training', construction: [{ goodType: 2, amount: 1 }] },
        { typeId: 2, id: 'farm', kind: 'workplace', construction: [{ goodType: 2, amount: 8 }] },
      ],
      buildingBobs: [
        { tribeId: 1, typeId: 1, level: 0, paletteName: 'house01' },
        { tribeId: 1, typeId: 1, level: 0, paletteName: 'house02' },
      ],
    });
  });

  it('validates disjoint row additions together against the complete ContentSet', () => {
    const merged = mergeContentModPatches(BASE, [
      { goods: [{ typeId: 1, id: 'wood', atomics: { harvest: 0 } }] },
      { goods: [{ typeId: 2, id: 'stone', atomics: { harvest: 0 } }] },
    ]);
    expect(merged.goods.map(({ id }) => id)).toEqual(['wood', 'stone']);
  });

  it("adds a pack's flagged people as its own tribes row beside the authored ones", () => {
    const merged = mergeContentModPatches(BASE, [
      {
        tribes: [
          {
            typeId: 42,
            id: 'northmen',
            name: 'Northmen',
            civilization: true,
            atomicBindings: [],
            jobEnables: [],
            jobRequirements: [],
          },
        ],
      },
    ]);
    expect(merged.tribes).toEqual([
      {
        typeId: 42,
        id: 'northmen',
        name: 'Northmen',
        civilization: true,
        atomicBindings: [],
        jobEnables: [],
        jobRequirements: [],
      },
    ]);
  });

  it('rejects invalid rows with the failing lane and field', () => {
    expect(() =>
      mergeContentModPatches(BASE, [{ goods: [{ typeId: 1, id: 'wood', surprise: true }] }]),
    ).toThrow(/goods[\s\S]*surprise/);
  });
});
