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

  describe('colliding people fallback', () => {
    /** A minimal pack that adds one people under the given identity, in the shape
     *  `tools/mods/build-people-mod.mjs` writes: rules row, class weapons, name pools, house art and
     *  the voice tables. */
    function peoplePatch(typeId: number, slug: string) {
      return {
        tribes: [{ typeId, id: slug, name: 'Chinese', civilization: true }],
        weapons: [{ typeId: 1, id: `${slug}_fist`, tribeType: typeId }],
        personalNames: [{ id: `${slug}-male`, tribe: typeId, sex: 'male', names: ['Yao'] }],
        buildingBobs: [
          { tribeId: typeId, typeId: 1, level: 0, bmd: 'house', paletteName: 'house01', bobId: 0 },
        ],
        buildings: [{ typeId: 1, id: 'barracks', kind: 'training', tribeVariants: [{ tribe: typeId }] }],
        sounds: {
          staticGroups: [{ name: 'alert' }],
          attackAlerts: [{ tribe: typeId, front: 'base', group: 'alert' }],
          humanVoices: [{ tribe: typeId, voiceClass: 'male' }],
        },
        humanPalettes: {
          bases: {},
          ramps: {},
          recipes: [],
          players: [],
          armorRecipes: [],
          cartRecipes: { handcart: '', oxcart: '' },
          jobChanges: [{ tribe: typeId, job: 6 }],
          goodRecipes: [],
        },
      };
    }

    it('re-keys a second pack whose people identity the first pack already took', () => {
      const merged = mergeContentModPatches(BASE, [peoplePatch(42, 'chinese'), peoplePatch(42, 'chinese')]);
      expect(merged.tribes.map((t) => [t.id, t.typeId])).toEqual([
        ['chinese', 42],
        ['chinese-2', 43],
      ]);
      // Row ids the pack derived from its slug follow the rename, so the pools stay unique.
      expect(merged.personalNames.map((p) => [p.id, p.tribe])).toEqual([
        ['chinese-male', 42],
        ['chinese-2-male', 43],
      ]);
      expect(merged.weapons.map((w) => [w.id, w.tribeType])).toEqual([
        ['chinese_fist', 42],
        ['chinese-2_fist', 43],
      ]);
      expect(merged.buildingBobs.map((b) => b.tribeId)).toEqual([42, 43]);
      // The voice tables ride inside the `sounds` object, whose arrays replace on merge - the second
      // pack's re-keyed rows are the ones that survive, as with any two packs touching the bank.
      expect(merged.sounds.attackAlerts.map((a) => a.tribe)).toEqual([43]);
      expect(merged.sounds.humanVoices.map((v) => v.tribe)).toEqual([43]);
      expect(merged.humanPalettes.jobChanges.map((c) => c.tribe)).toEqual([43]);
      const barracks = merged.buildings.find((b) => b.id === 'barracks');
      expect(barracks?.tribeVariants?.map((v) => v.tribe)).toEqual([43]);
    });

    it('renames only the slug when the tribe id is free', () => {
      const merged = mergeContentModPatches(BASE, [peoplePatch(42, 'chinese'), peoplePatch(45, 'chinese')]);
      expect(merged.tribes.map((t) => [t.id, t.typeId])).toEqual([
        ['chinese', 42],
        ['chinese-2', 45],
      ]);
      expect(merged.personalNames.map((p) => [p.id, p.tribe])).toEqual([
        ['chinese-male', 42],
        ['chinese-2-male', 45],
      ]);
      expect(merged.weapons.map((w) => [w.id, w.tribeType])).toEqual([
        ['chinese_fist', 42],
        ['chinese-2_fist', 45],
      ]);
    });

    it('follows a pack whose rows kept the authored tribe while its own row moved to a free id', () => {
      // An edited pack: its tribe row sits on the free id 43, but its slug-derived rows still bind
      // the authored 42 - they are the pack's people either way and follow it onto 43.
      const second = { ...peoplePatch(43, 'chinese') };
      second.weapons = [{ typeId: 1, id: 'chinese_fist', tribeType: 42 }];
      second.personalNames = [{ id: 'chinese-male', tribe: 42, sex: 'male', names: ['Yao'] }];
      const merged = mergeContentModPatches(BASE, [peoplePatch(42, 'chinese'), second]);
      expect(merged.tribes.map((t) => [t.id, t.typeId])).toEqual([
        ['chinese', 42],
        ['chinese-2', 43],
      ]);
      expect(merged.weapons.map((w) => [w.id, w.tribeType])).toEqual([
        ['chinese_fist', 42],
        ['chinese-2_fist', 43],
      ]);
      expect(merged.personalNames.map((p) => [p.id, p.tribe])).toEqual([
        ['chinese-male', 42],
        ['chinese-2-male', 43],
      ]);
    });

    it('re-keys a flagless pack whose pools bind a held (tribe, sex) under foreign ids', () => {
      // Pools cannot override through a different id, so a flagless pack bringing `han-male` onto a
      // (tribe, sex) pair another pack's pool holds is a second people and re-keys like a flagged one.
      const second = { ...peoplePatch(42, 'chinese') };
      const secondTribe = (second.tribes as Array<Record<string, unknown>>)[0];
      if (secondTribe) delete secondTribe.civilization;
      second.personalNames = [{ id: 'han-male', tribe: 42, sex: 'male', names: ['Yao'] }];
      const merged = mergeContentModPatches(BASE, [peoplePatch(42, 'chinese'), second]);
      expect(merged.tribes.map((t) => [t.id, t.typeId])).toEqual([
        ['chinese', 42],
        ['chinese-2', 43],
      ]);
      expect(merged.personalNames.map((p) => [p.id, p.tribe])).toEqual([
        ['chinese-male', 42],
        ['han-male', 43],
      ]);
    });

    it('keeps a flagless pack as a plain override when its pools override by their own ids', () => {
      const merged = mergeContentModPatches(BASE, [
        peoplePatch(42, 'chinese'),
        {
          tribes: [{ typeId: 42, id: 'chinese', name: 'Han' }],
          personalNames: [{ id: 'chinese-male', tribe: 42, sex: 'male', names: ['Li'] }],
        },
      ]);
      expect(merged.tribes.map((t) => [t.id, t.name, t.typeId])).toEqual([['chinese', 'Han', 42]]);
      expect(merged.personalNames.map((p) => [p.id, p.tribe, p.names])).toEqual([
        ['chinese-male', 42, ['Li']],
      ]);
    });

    it('re-keys a third pack arriving on the same identity again', () => {
      const merged = mergeContentModPatches(BASE, [
        peoplePatch(42, 'chinese'),
        peoplePatch(42, 'chinese'),
        peoplePatch(42, 'chinese'),
      ]);
      expect(merged.tribes.map((t) => [t.id, t.typeId])).toEqual([
        ['chinese', 42],
        ['chinese-2', 43],
        ['chinese-3', 44],
      ]);
    });

    it('renumbers only the tribe id when the slug is free', () => {
      const merged = mergeContentModPatches(BASE, [peoplePatch(42, 'chinese'), peoplePatch(42, 'han')]);
      expect(merged.tribes.map((t) => [t.id, t.typeId])).toEqual([
        ['chinese', 42],
        ['han', 43],
      ]);
      expect(merged.personalNames.map((p) => [p.id, p.tribe])).toEqual([
        ['chinese-male', 42],
        ['han-male', 43],
      ]);
      expect(merged.weapons.map((w) => [w.id, w.tribeType])).toEqual([
        ['chinese_fist', 42],
        ['han_fist', 43],
      ]);
    });

    it('keeps the override semantics for rows without the civilization flag', () => {
      const base = parseContentSet({
        manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic' } },
        goods: [],
        jobs: [],
        buildings: [],
        tribes: [{ typeId: 1, id: 'viking' }],
      });
      const merged = mergeContentModPatches(base, [
        { tribes: [{ typeId: 1, id: 'viking', name: 'Norsemen' }] },
      ]);
      expect(merged.tribes.map((t) => [t.id, t.name, t.typeId])).toEqual([['viking', 'Norsemen', 1]]);
    });

    it('leaves the pack that seeds the set without base content in possession of its identity', () => {
      const seeded = {
        manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic' } },
        goods: [],
        jobs: [],
        jobExperience: [],
        buildings: [],
        weapons: [],
        armor: [],
        animals: [],
        vehicles: [],
        landscape: [],
        landscapeGfx: [],
        gatheringPipeline: [],
        gfxPatterns: [],
        gfxPatternTransitions: [],
        terrainPatterns: [],
        trianglePatternTypes: [],
        bobSequences: [],
        jobGraphics: [],
        humanPalettes: {
          bases: {},
          ramps: {},
          recipes: [],
          players: [],
          armorRecipes: [],
          cartRecipes: { handcart: '', oxcart: '' },
          jobChanges: [],
          goodRecipes: [],
        },
        gfxAtomics: [],
        gfxWalkAtomics: [],
        gfxInHousePrograms: [],
        particles: [],
        vehicleGraphics: [],
        buildingBobs: [],
        constructionLayers: [],
        buildingOverlays: [],
        buildingLandscapeOverlays: [],
        buildingFlagPoints: [],
        buildingSoldierFlagPoints: [],
        buildingHolyFirePoints: [],
        tribes: [{ typeId: 42, id: 'chinese', name: 'Chinese', civilization: true }],
        personalNames: [],
        atomicAnimations: [],
        maps: [],
        sounds: {},
      };
      const merged = mergeContentModPatches(null, [seeded]);
      expect(merged.tribes.map((t) => [t.id, t.typeId])).toEqual([['chinese', 42]]);
    });

    it('keeps a flagged row that echoes the base people in place instead of re-keying it', () => {
      const base = parseContentSet({
        manifest: { version: IR_VERSION, generatedFrom: { data: 'synthetic' } },
        goods: [],
        jobs: [],
        buildings: [],
        tribes: [{ typeId: 1, id: 'viking', name: 'Vikings', civilization: true }],
      });
      // A pack whose flagged row names an identity the base itself carries (a full-IR pack) is that
      // same people coming back: it overrides in place and never takes a second identity.
      const echo = mergeContentModPatches(base, [
        { tribes: [{ typeId: 1, id: 'viking', name: 'Vikings', civilization: true }] },
      ]);
      expect(echo.tribes.map((t) => [t.id, t.typeId])).toEqual([['viking', 1]]);
      // Only the identity the base itself carries is an echo. The second pack of this very install
      // still re-keys: `merged` already carries the first pack's people when its turn comes.
      const second = mergeContentModPatches(base, [
        { tribes: [{ typeId: 1, id: 'viking', name: 'Vikings', civilization: true }] },
        { tribes: [{ typeId: 2, id: 'chinese', name: 'Chinese', civilization: true }] },
        { tribes: [{ typeId: 2, id: 'chinese', name: 'Chinese II', civilization: true }] },
      ]);
      expect(second.tribes.map((t) => [t.id, t.typeId])).toEqual([
        ['viking', 1],
        ['chinese', 2],
        ['chinese-2', 3],
      ]);
    });
  });
});
