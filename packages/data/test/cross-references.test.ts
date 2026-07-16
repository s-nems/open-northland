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
  /**
   * One dangling-reference case per row: `overrides` replaces the named tables in `base()` so the set
   * exercises exactly one rule, and `error` is the message that rule must throw. Grouped by the entity
   * family the bad reference lives on.
   */
  const REJECT_CASES: { name: string; overrides: Record<string, unknown>; error: RegExp }[] = [
    // goods
    {
      name: 'a production input naming an unknown good',
      overrides: {
        goods: [
          { typeId: 0, id: 'none' },
          { typeId: 1, id: 'wood', productionInputs: [{ goodType: UNKNOWN, amount: 1 }] },
        ],
      },
      error: /good "wood" consumes unknown input goodType 99/,
    },
    {
      name: 'an unknown landscapeType on a good',
      overrides: {
        goods: [
          { typeId: 0, id: 'none' },
          { typeId: 1, id: 'wood', landscapeType: UNKNOWN },
        ],
      },
      error: /good "wood" references unknown landscape typeId 99/,
    },
    {
      name: 'an unknown landscape id in a gathering stage',
      overrides: {
        goods: [
          { typeId: 0, id: 'none' },
          { typeId: 1, id: 'wood', gathering: { harvest: UNKNOWN } },
        ],
      },
      error: /good "wood" gathering harvest references unknown landscape typeId 99/,
    },
    // buildings
    {
      name: 'a worker slot naming an unknown job',
      overrides: {
        buildings: [{ typeId: 1, id: 'shed', kind: 'workplace', workers: [{ jobType: UNKNOWN, count: 1 }] }],
      },
      error: /building "shed" references unknown jobType 99/,
    },
    {
      name: 'a stock slot naming an unknown good',
      overrides: {
        buildings: [{ typeId: 1, id: 'shed', kind: 'storage', stock: [{ goodType: UNKNOWN, capacity: 1 }] }],
      },
      error: /building "shed" references unknown goodType 99/,
    },
    {
      name: 'an unknown produced good',
      overrides: { buildings: [{ typeId: 1, id: 'shed', kind: 'workplace', produces: [UNKNOWN] }] },
      error: /building "shed" produces unknown goodType 99/,
    },
    {
      name: 'an unknown construction good',
      overrides: {
        buildings: [
          { typeId: 1, id: 'shed', kind: 'workplace', construction: [{ goodType: UNKNOWN, amount: 1 }] },
        ],
      },
      error: /building "shed" construction needs unknown goodType 99/,
    },
    {
      name: 'an unknown good in a recipe',
      overrides: {
        buildings: [
          {
            typeId: 1,
            id: 'shed',
            kind: 'workplace',
            recipes: [{ inputs: [{ goodType: UNKNOWN, amount: 1 }], outputs: [] }],
          },
        ],
      },
      error: /building "shed" recipe references unknown goodType 99/,
    },
    // tribes
    {
      name: 'an atomic binding naming an unknown job',
      overrides: {
        tribes: [
          { typeId: 1, id: 'viking', atomicBindings: [{ jobType: UNKNOWN, atomicId: 24, animation: 'a' }] },
        ],
      },
      error: /tribe "viking" binds atomic 24 to unknown jobType 99/,
    },
    {
      name: 'a jobEnables edge with an unknown enabling job',
      overrides: {
        tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: UNKNOWN, kind: 'good', targetId: 1 }] }],
      },
      error: /tribe "viking" jobEnables-edge has unknown jobType 99/,
    },
    {
      name: 'a jobEnables good target that does not resolve',
      overrides: {
        tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'good', targetId: UNKNOWN }] }],
      },
      error: /tribe "viking" job 1 enables unknown goodType 99/,
    },
    {
      name: 'a jobEnables house target that does not resolve',
      overrides: {
        tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'house', targetId: UNKNOWN }] }],
      },
      error: /tribe "viking" job 1 enables unknown buildingType 99/,
    },
    {
      name: 'a jobEnables job target that does not resolve',
      overrides: {
        tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'job', targetId: UNKNOWN }] }],
      },
      error: /tribe "viking" job 1 enables unknown jobType 99/,
    },
    {
      name: 'a jobEnables vehicle target that does not resolve',
      overrides: {
        tribes: [
          { typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'vehicle', targetId: UNKNOWN }] },
        ],
      },
      error: /tribe "viking" job 1 enables unknown vehicleType 99/,
    },
    {
      name: 'a job requirement naming an unknown job target',
      overrides: {
        tribes: [
          {
            typeId: 1,
            id: 'viking',
            jobRequirements: [{ requirement: 'need', target: 'job', targetId: UNKNOWN, amount: 1 }],
          },
        ],
      },
      error: /tribe "viking" needforjob requires unknown jobType 99/,
    },
    {
      name: 'a job requirement naming an unknown good target',
      overrides: {
        tribes: [
          {
            typeId: 1,
            id: 'viking',
            jobRequirements: [{ requirement: 'need', target: 'good', targetId: UNKNOWN, amount: 1 }],
          },
        ],
      },
      error: /tribe "viking" needforgood requires unknown goodType 99/,
    },
    // equipment
    {
      name: 'a weapon naming an unknown wielding job',
      overrides: { weapons: [{ typeId: 1, id: 'axe', jobType: UNKNOWN }] },
      error: /weapon "axe" references unknown jobType 99/,
    },
    {
      name: 'a weapon naming an unknown good',
      overrides: { weapons: [{ typeId: 1, id: 'axe', goodType: UNKNOWN }] },
      error: /weapon "axe" references unknown goodType 99/,
    },
    {
      name: 'an armor naming an unknown good',
      overrides: { armor: [{ typeId: 1, id: 'mail', goodType: UNKNOWN }] },
      error: /armor "mail" references unknown goodType 99/,
    },
    // landscape
    {
      name: 'a landscapeGfx logicType that does not resolve',
      overrides: { landscapeGfx: [{ index: 0, editName: 'tree', logicType: 5 }] },
      error: /landscapeGfx "tree" references unknown landscape typeId 5/,
    },
    // gathering pipeline
    {
      name: 'a pipeline naming an unknown good',
      overrides: { gatheringPipeline: [{ goodType: UNKNOWN, goodId: 'ghost' }] },
      error: /gatheringPipeline good "ghost" references unknown goodType 99/,
    },
    {
      name: 'a pipeline stage naming an unknown landscape type',
      overrides: {
        gatheringPipeline: [
          { goodType: 1, goodId: 'wood', harvest: { landscapeType: UNKNOWN, gfxIndices: [] } },
        ],
      },
      error: /gatheringPipeline good "wood" harvest references unknown landscape typeId 99/,
    },
    {
      name: 'a pipeline stage naming an unknown landscapeGfx index',
      overrides: {
        landscape: [{ typeId: 0, id: 'grass' }],
        gatheringPipeline: [
          { goodType: 1, goodId: 'wood', harvest: { landscapeType: 0, gfxIndices: [UNKNOWN] } },
        ],
      },
      error: /gatheringPipeline good "wood" harvest references unknown landscapeGfx index 99/,
    },
    // terrain patterns
    {
      name: 'a terrainPattern whose representative pick is absent from the pattern table',
      overrides: {
        gfxPatterns: [{ id: 1 }],
        terrainPatterns: [{ ...terrainPattern(), patternId: UNKNOWN }],
      },
      error: /terrainPattern for typeId 0 references unknown patternId 99/,
    },
    // job experience
    {
      name: 'an experience track naming an unknown job',
      overrides: { jobExperience: [{ typeId: 1, id: 'chop_xp', jobType: UNKNOWN }] },
      error: /jobExperience "chop_xp" references unknown jobType 99/,
    },
    {
      name: 'a good-specific experience track naming an unknown good',
      overrides: { jobExperience: [{ typeId: 1, id: 'chop_xp', jobType: 1, goodType: UNKNOWN }] },
      error: /jobExperience "chop_xp" references unknown goodType 99/,
    },
  ];

  it.each(REJECT_CASES)('rejects $name', ({ overrides, error }) => {
    expect(() => parseWith(overrides)).toThrow(error);
  });

  /** The minimal valid set plus the deliberate carve-outs — these must NOT throw. */
  const ACCEPT_CASES: { name: string; overrides: Record<string, unknown> }[] = [
    { name: 'a minimal internally-consistent set', overrides: {} },
    {
      name: 'a jobEnables vehicle target that resolves against the vehicle table (carve-out)',
      overrides: {
        vehicles: [{ typeId: 5, id: 'cart' }],
        tribes: [{ typeId: 1, id: 'viking', jobEnables: [{ jobType: 1, kind: 'vehicle', targetId: 5 }] }],
      },
    },
    {
      name: 'a wide-id experienceTypes id (carve-out — experienceTypes ids are not resolved)',
      overrides: {
        tribes: [
          {
            typeId: 1,
            id: 'viking',
            jobRequirements: [
              { requirement: 'train', target: 'good', targetId: 1, amount: 1, experienceTypes: [777] },
            ],
          },
        ],
      },
    },
    {
      name: 'a dangling terrainPattern pick when the pattern table is not carried (check skipped)',
      overrides: { terrainPatterns: [{ ...terrainPattern(), patternId: UNKNOWN }] },
    },
  ];

  it.each(ACCEPT_CASES)('accepts $name', ({ overrides }) => {
    expect(() => parseWith(overrides)).not.toThrow();
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
