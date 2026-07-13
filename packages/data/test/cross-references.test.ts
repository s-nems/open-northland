import { describe, expect, it } from 'vitest';
import { IR_VERSION, parseContentSet } from '../src/index.js';

/**
 * These lock the failure surface of `validateCrossReferences` (run inside `parseContentSet`): every
 * dangling-reference branch throws, and the deliberate carve-outs (the `vehicle` jobEnables kind, the
 * unchecked `experienceTypes`) do NOT. They are the safety net the decomposed validator must keep
 * green — a refactor that drops or inverts a check surfaces here, not silently in generated content.
 *
 * The set is hand-authored synthetic data (no game bytes): a minimal valid base plus one bad
 * reference per case. Everything not named defaults to an empty table, so each case exercises exactly
 * one rule.
 */
function base(): Record<string, unknown> {
  return {
    manifest: { version: IR_VERSION, generatedFrom: { game: 'synthetic-test-fixture' }, locale: 'eng' },
    goods: [
      { typeId: 0, id: 'none' },
      { typeId: 1, id: 'wood' },
    ],
    jobs: [
      { typeId: 0, id: 'idle' },
      { typeId: 1, id: 'chopper' },
    ],
    buildings: [],
  };
}

const UNKNOWN = 99;

/** A schema-valid TerrainPattern row; cases override `patternId` to make its representative pick dangle. */
function terrainPattern(): Record<string, unknown> {
  return {
    typeId: 0,
    family: 'land',
    patternId: 1,
    logicType: 0,
    texture: 'text_000.pcx',
    coordsA: [0, 0, 1, 0, 0, 1],
    coordsB: [1, 1, 1, 0, 0, 1],
  };
}

/** Build a set from `base()` with the given top-level tables replaced, then parse+validate it. */
function parseWith(overrides: Record<string, unknown>): void {
  parseContentSet({ ...base(), ...overrides });
}

describe('validateCrossReferences', () => {
  it('accepts a minimal internally-consistent set', () => {
    expect(() => parseWith({})).not.toThrow();
  });

  describe('goods', () => {
    it('rejects a production input naming an unknown good', () => {
      expect(() =>
        parseWith({
          goods: [
            { typeId: 0, id: 'none' },
            { typeId: 1, id: 'wood', productionInputs: [{ goodType: UNKNOWN, amount: 1 }] },
          ],
        }),
      ).toThrow(/good "wood" consumes unknown input goodType 99/);
    });

    it('rejects an unknown landscapeType on a good', () => {
      expect(() =>
        parseWith({
          goods: [
            { typeId: 0, id: 'none' },
            { typeId: 1, id: 'wood', landscapeType: UNKNOWN },
          ],
        }),
      ).toThrow(/good "wood" references unknown landscape typeId 99/);
    });

    it('rejects an unknown landscape id in a gathering stage', () => {
      expect(() =>
        parseWith({
          goods: [
            { typeId: 0, id: 'none' },
            { typeId: 1, id: 'wood', gathering: { harvest: UNKNOWN } },
          ],
        }),
      ).toThrow(/good "wood" gathering harvest references unknown landscape typeId 99/);
    });
  });

  describe('buildings', () => {
    it('rejects a worker slot naming an unknown job', () => {
      expect(() =>
        parseWith({
          buildings: [
            { typeId: 1, id: 'shed', kind: 'workplace', workers: [{ jobType: UNKNOWN, count: 1 }] },
          ],
        }),
      ).toThrow(/building "shed" references unknown jobType 99/);
    });

    it('rejects a stock slot naming an unknown good', () => {
      expect(() =>
        parseWith({
          buildings: [
            { typeId: 1, id: 'shed', kind: 'storage', stock: [{ goodType: UNKNOWN, capacity: 1 }] },
          ],
        }),
      ).toThrow(/building "shed" references unknown goodType 99/);
    });

    it('rejects an unknown produced good', () => {
      expect(() =>
        parseWith({ buildings: [{ typeId: 1, id: 'shed', kind: 'workplace', produces: [UNKNOWN] }] }),
      ).toThrow(/building "shed" produces unknown goodType 99/);
    });

    it('rejects an unknown construction good', () => {
      expect(() =>
        parseWith({
          buildings: [
            { typeId: 1, id: 'shed', kind: 'workplace', construction: [{ goodType: UNKNOWN, amount: 1 }] },
          ],
        }),
      ).toThrow(/building "shed" construction needs unknown goodType 99/);
    });

    it('rejects an unknown good in a recipe', () => {
      expect(() =>
        parseWith({
          buildings: [
            {
              typeId: 1,
              id: 'shed',
              kind: 'workplace',
              recipe: { inputs: [{ goodType: UNKNOWN, amount: 1 }], outputs: [] },
            },
          ],
        }),
      ).toThrow(/building "shed" recipe references unknown goodType 99/);
    });
  });

  describe('tribes', () => {
    it('rejects an atomic binding naming an unknown job', () => {
      expect(() =>
        parseWith({
          tribes: [
            { typeId: 1, id: 'viking', atomicBindings: [{ jobType: UNKNOWN, atomicId: 24, animation: 'a' }] },
          ],
        }),
      ).toThrow(/tribe "viking" binds atomic 24 to unknown jobType 99/);
    });

    it('rejects a jobEnables edge with an unknown enabling job', () => {
      expect(() =>
        parseWith({
          tribes: [
            { typeId: 1, id: 'viking', jobEnables: [{ jobType: UNKNOWN, kind: 'good', targetId: 1 }] },
          ],
        }),
      ).toThrow(/tribe "viking" jobEnables-edge has unknown jobType 99/);
    });

    it('rejects a jobEnables good target that does not resolve', () => {
      expect(() =>
        parseWith({
          tribes: [
            { typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'good', targetId: UNKNOWN }] },
          ],
        }),
      ).toThrow(/tribe "viking" job 1 enables unknown goodType 99/);
    });

    it('rejects a jobEnables house target that does not resolve', () => {
      expect(() =>
        parseWith({
          tribes: [
            { typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'house', targetId: UNKNOWN }] },
          ],
        }),
      ).toThrow(/tribe "viking" job 1 enables unknown buildingType 99/);
    });

    it('rejects a jobEnables job target that does not resolve', () => {
      expect(() =>
        parseWith({
          tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'job', targetId: UNKNOWN }] }],
        }),
      ).toThrow(/tribe "viking" job 1 enables unknown jobType 99/);
    });

    it('rejects a jobEnables vehicle target that does not resolve', () => {
      expect(() =>
        parseWith({
          tribes: [
            { typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'vehicle', targetId: UNKNOWN }] },
          ],
        }),
      ).toThrow(/tribe "viking" job 1 enables unknown vehicleType 99/);
    });

    it('accepts a jobEnables vehicle target that resolves against the vehicle table (carve-out)', () => {
      expect(() =>
        parseWith({
          vehicles: [{ typeId: 5, id: 'cart' }],
          tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'vehicle', targetId: 5 }] }],
        }),
      ).not.toThrow();
    });

    it('rejects a job requirement naming an unknown job target', () => {
      expect(() =>
        parseWith({
          tribes: [
            {
              typeId: 1,
              id: 'viking',
              jobRequirements: [{ requirement: 'need', target: 'job', targetId: UNKNOWN, amount: 1 }],
            },
          ],
        }),
      ).toThrow(/tribe "viking" needforjob requires unknown jobType 99/);
    });

    it('rejects a job requirement naming an unknown good target', () => {
      expect(() =>
        parseWith({
          tribes: [
            {
              typeId: 1,
              id: 'viking',
              jobRequirements: [{ requirement: 'need', target: 'good', targetId: UNKNOWN, amount: 1 }],
            },
          ],
        }),
      ).toThrow(/tribe "viking" needforgood requires unknown goodType 99/);
    });

    it('does NOT resolve experienceTypes ids (carve-out) — a wide-id experience type passes', () => {
      expect(() =>
        parseWith({
          tribes: [
            {
              typeId: 1,
              id: 'viking',
              jobRequirements: [
                { requirement: 'train', target: 'good', targetId: 1, amount: 1, experienceTypes: [777] },
              ],
            },
          ],
        }),
      ).not.toThrow();
    });
  });

  describe('equipment', () => {
    it('rejects a weapon naming an unknown wielding job', () => {
      expect(() => parseWith({ weapons: [{ typeId: 1, id: 'axe', jobType: UNKNOWN }] })).toThrow(
        /weapon "axe" references unknown jobType 99/,
      );
    });

    it('rejects a weapon naming an unknown good', () => {
      expect(() => parseWith({ weapons: [{ typeId: 1, id: 'axe', goodType: UNKNOWN }] })).toThrow(
        /weapon "axe" references unknown goodType 99/,
      );
    });

    it('rejects an armor naming an unknown good', () => {
      expect(() => parseWith({ armor: [{ typeId: 1, id: 'mail', goodType: UNKNOWN }] })).toThrow(
        /armor "mail" references unknown goodType 99/,
      );
    });
  });

  describe('landscape', () => {
    it('rejects a landscapeGfx logicType that does not resolve', () => {
      expect(() => parseWith({ landscapeGfx: [{ index: 0, editName: 'tree', logicType: 5 }] })).toThrow(
        /landscapeGfx "tree" references unknown landscape typeId 5/,
      );
    });
  });

  describe('gathering pipeline', () => {
    it('rejects a pipeline naming an unknown good', () => {
      expect(() => parseWith({ gatheringPipeline: [{ goodType: UNKNOWN, goodId: 'ghost' }] })).toThrow(
        /gatheringPipeline good "ghost" references unknown goodType 99/,
      );
    });

    it('rejects a pipeline stage naming an unknown landscape type', () => {
      expect(() =>
        parseWith({
          gatheringPipeline: [
            { goodType: 1, goodId: 'wood', harvest: { landscapeType: UNKNOWN, gfxIndices: [] } },
          ],
        }),
      ).toThrow(/gatheringPipeline good "wood" harvest references unknown landscape typeId 99/);
    });

    it('rejects a pipeline stage naming an unknown landscapeGfx index', () => {
      expect(() =>
        parseWith({
          landscape: [{ typeId: 0, id: 'grass' }],
          gatheringPipeline: [
            { goodType: 1, goodId: 'wood', harvest: { landscapeType: 0, gfxIndices: [UNKNOWN] } },
          ],
        }),
      ).toThrow(/gatheringPipeline good "wood" harvest references unknown landscapeGfx index 99/);
    });
  });

  describe('terrain patterns', () => {
    it('rejects a terrainPattern whose representative pick is absent from the pattern table', () => {
      expect(() =>
        parseWith({
          gfxPatterns: [{ id: 1 }],
          terrainPatterns: [{ ...terrainPattern(), patternId: UNKNOWN }],
        }),
      ).toThrow(/terrainPattern for typeId 0 references unknown patternId 99/);
    });

    it('skips the pattern check entirely when the pattern table is not carried', () => {
      // gfxPatterns empty -> the representative-pick check is not in-set checkable, so it is skipped.
      expect(() =>
        parseWith({ terrainPatterns: [{ ...terrainPattern(), patternId: UNKNOWN }] }),
      ).not.toThrow();
    });
  });

  describe('job experience', () => {
    it('rejects an experience track naming an unknown job', () => {
      expect(() => parseWith({ jobExperience: [{ typeId: 1, id: 'chop_xp', jobType: UNKNOWN }] })).toThrow(
        /jobExperience "chop_xp" references unknown jobType 99/,
      );
    });

    it('rejects a good-specific experience track naming an unknown good', () => {
      expect(() =>
        parseWith({ jobExperience: [{ typeId: 1, id: 'chop_xp', jobType: 1, goodType: UNKNOWN }] }),
      ).toThrow(/jobExperience "chop_xp" references unknown goodType 99/);
    });
  });

  it('reports every failure at once, in table order (goods before buildings)', () => {
    let message = '';
    try {
      parseContentSet({
        ...base(),
        goods: [
          { typeId: 0, id: 'none' },
          { typeId: 1, id: 'wood', productionInputs: [{ goodType: UNKNOWN, amount: 1 }] },
        ],
        buildings: [{ typeId: 1, id: 'shed', kind: 'workplace', workers: [{ jobType: UNKNOWN, count: 1 }] }],
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/Content cross-reference validation failed:/);
    const goodAt = message.indexOf('good "wood" consumes');
    const buildingAt = message.indexOf('building "shed" references');
    expect(goodAt).toBeGreaterThanOrEqual(0);
    expect(buildingAt).toBeGreaterThan(goodAt);
  });
});
