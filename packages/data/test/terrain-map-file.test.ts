import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseTerrainMap, TRANSITION_NONE, TRANSITION_PAIRS } from '../src/index.js';

/**
 * The cross-lane invariant table of `TerrainMapFile`, one broken lane per case, over hand-authored
 * synthetic maps (no game bytes). The fixture's width, height, cell count and two half-cell bounds
 * are five distinct numbers, so no rule can stay green by reaching for the wrong one.
 */

/** Cells in the fixture grid: `width * height`. */
const CELLS = 12;
/** One past the fixture's half-cell columns (`width * HALF_CELLS_PER_CELL`). */
const HALF_CELL_X_BOUND = 8;
/** One past the fixture's half-cell rows (`height * HALF_CELLS_PER_CELL`). */
const HALF_CELL_Y_BOUND = 6;
/** One past the last index of the fixture's `ground.patterns` and `objects.types` lists. */
const UNKNOWN_INDEX = 2;
/** The highest in-dictionary `emt` value for two transition types: record 1, its last pair variant. */
const LAST_TRANSITION_VALUE = TRANSITION_PAIRS * 2 - 1;
/** The first `emt` value past that dictionary: record 2. */
const OUT_OF_DICT_TRANSITION_VALUE = TRANSITION_PAIRS * 2;

/** A valid per-cell lane. The typeIds, elevation, brightness and shore rules check only its length. */
const PER_CELL_LANE: readonly number[] = Array.from({ length: CELLS }, (_, cell) => cell);

/** A per-cell transition lane of `TRANSITION_NONE` with the named cells overridden. */
function transitionLane(overrides: Readonly<Record<number, number>> = {}): number[] {
  return Array.from({ length: CELLS }, (_, cell) => overrides[cell] ?? TRANSITION_NONE);
}

const GROUND = {
  patterns: ['meadow 01', 'water 01'],
  a: Array.from({ length: CELLS }, (_, cell) => cell % 2),
  b: Array.from({ length: CELLS }, (_, cell) => (cell + 1) % 2),
} as const;

const TRANSITIONS = {
  types: ['beach 1', 'beach 2'],
  a1: transitionLane({ 0: 0 }),
  b1: transitionLane({ 1: LAST_TRANSITION_VALUE }),
  a2: transitionLane(),
  b2: transitionLane(),
} as const;

const OBJECT_TYPES = ['palm 03', 'stones 02 grey'];
/** Two triples: the first half-cell node, and the last one holding the last type index. */
const PLACEMENTS: readonly number[] = [
  0,
  0,
  0,
  HALF_CELL_X_BOUND - 1,
  HALF_CELL_Y_BOUND - 1,
  OBJECT_TYPES.length - 1,
];
const OBJECTS = { types: OBJECT_TYPES, placements: PLACEMENTS, levels: [1, 2] } as const;

/** A 4x3 map carrying every optional lane at a valid size. */
function base(): Record<string, unknown> {
  return {
    width: 4,
    height: 3,
    typeIds: PER_CELL_LANE,
    ground: GROUND,
    transitions: TRANSITIONS,
    objects: OBJECTS,
    elevation: PER_CELL_LANE,
    brightness: PER_CELL_LANE,
    shore: PER_CELL_LANE,
    continents: new Array(HALF_CELL_X_BOUND * HALF_CELL_Y_BOUND).fill(7),
    fishSwarms: [{ hx: HALF_CELL_X_BOUND - 1, hy: HALF_CELL_Y_BOUND - 1, count: 30, continent: 7 }],
  };
}

/** Every issue `parseTerrainMap` reports for a map, at the path the invariant table assigns it. */
function issues(map: unknown): { path: string; message: string }[] {
  try {
    parseTerrainMap(map);
    return [];
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
  }
}

describe('parseTerrainMap cross-lane invariants', () => {
  /**
   * One broken lane per row: `map` replaces exactly one field of `base()`, and the row's path and
   * message are the only issue it may raise, so a fixture that also trips a shape rule or a second
   * invariant fails here rather than passing for the wrong reason.
   */
  const REJECT_CASES: readonly {
    name: string;
    map: Record<string, unknown>;
    path: string;
    message: string;
  }[] = [
    // grid
    {
      name: 'a typeIds lane whose length disagrees with width*height',
      map: { ...base(), typeIds: [1, 2, 3] },
      path: 'typeIds',
      message: 'terrain map typeIds length 3 != width*height (4*3 = 12)',
    },
    // ground
    {
      name: 'a ground triangle lane one cell short',
      map: { ...base(), ground: { ...GROUND, a: GROUND.a.slice(0, -1) } },
      path: 'ground',
      message: 'terrain map ground lanes must be width*height (12) cells',
    },
    {
      name: 'a ground triangle lane indexing past its pattern list',
      map: { ...base(), ground: { ...GROUND, b: [...GROUND.b.slice(0, -1), UNKNOWN_INDEX] } },
      path: 'ground',
      message: 'terrain map ground lane indexes outside its patterns list',
    },
    // transitions
    {
      name: 'a transition lane one cell short',
      map: { ...base(), transitions: { ...TRANSITIONS, a2: TRANSITIONS.a2.slice(0, -1) } },
      path: 'transitions',
      message: 'terrain map transition lanes must be width*height (12) cells',
    },
    {
      name: 'a transition lane value selecting a record past its types dictionary',
      map: {
        ...base(),
        transitions: { ...TRANSITIONS, b2: transitionLane({ 3: OUT_OF_DICT_TRANSITION_VALUE }) },
      },
      path: 'transitions',
      message: 'terrain map transition lane values outside its types dictionary',
    },
    // objects.placements
    {
      // No levels lane: it counts triples, so a partial placements lane would break that rule too.
      name: 'a placements lane that is not a whole number of triples',
      map: { ...base(), objects: { types: OBJECT_TYPES, placements: PLACEMENTS.slice(0, -1) } },
      path: 'objects.placements',
      message: 'terrain map objects.placements must be flat [hx, hy, typeIndex] triples',
    },
    {
      name: 'a placement at the half-cell column bound',
      map: { ...base(), objects: { ...OBJECTS, placements: [HALF_CELL_X_BOUND, 0, 0, 0, 0, 0] } },
      path: 'objects.placements',
      message: 'terrain map objects.placements triple out of range (half-cell coords / types index)',
    },
    {
      name: 'a placement at the half-cell row bound',
      map: { ...base(), objects: { ...OBJECTS, placements: [0, HALF_CELL_Y_BOUND, 0, 0, 0, 0] } },
      path: 'objects.placements',
      message: 'terrain map objects.placements triple out of range (half-cell coords / types index)',
    },
    {
      name: 'a placement naming a type index past the types list',
      map: { ...base(), objects: { ...OBJECTS, placements: [0, 0, UNKNOWN_INDEX, 0, 0, 0] } },
      path: 'objects.placements',
      message: 'terrain map objects.placements triple out of range (half-cell coords / types index)',
    },
    {
      name: 'a second placement triple out of range behind a valid first one',
      map: { ...base(), objects: { ...OBJECTS, placements: [0, 0, 0, 0, 0, UNKNOWN_INDEX] } },
      path: 'objects.placements',
      message: 'terrain map objects.placements triple out of range (half-cell coords / types index)',
    },
    // objects.levels
    {
      name: 'a levels lane with fewer entries than placement triples',
      map: { ...base(), objects: { ...OBJECTS, levels: [1] } },
      path: 'objects.levels',
      message: 'terrain map objects.levels must carry one entry per placement triple',
    },
    // per-cell lanes
    {
      name: 'an elevation lane one cell short',
      map: { ...base(), elevation: PER_CELL_LANE.slice(0, -1) },
      path: 'elevation',
      message: 'terrain map elevation length 11 != width*height (12)',
    },
    {
      name: 'a brightness lane one cell short',
      map: { ...base(), brightness: PER_CELL_LANE.slice(0, -1) },
      path: 'brightness',
      message: 'terrain map brightness length 11 != width*height (12)',
    },
    {
      name: 'a shore lane one cell short',
      map: { ...base(), shore: PER_CELL_LANE.slice(0, -1) },
      path: 'shore',
      message: 'terrain map shore length 11 != width*height (12)',
    },
    {
      name: 'a continent lane one half-cell short',
      map: {
        ...base(),
        continents: new Array(HALF_CELL_X_BOUND * HALF_CELL_Y_BOUND - 1).fill(7),
      },
      path: 'continents',
      message: 'terrain map continents length 47 != width*height*4 (48)',
    },
    {
      name: 'a fish swarm outside the half-cell grid',
      map: { ...base(), fishSwarms: [{ hx: HALF_CELL_X_BOUND, hy: 0, count: 1, continent: 0 }] },
      path: 'fishSwarms',
      message: 'terrain map fish swarm lies outside the half-cell grid',
    },
    {
      name: 'populated fish swarms without continent data',
      map: { ...base(), continents: undefined },
      path: 'continents',
      message: 'terrain map populated fish swarms require a continent lane',
    },
  ];

  it.each(REJECT_CASES)('rejects $name', ({ map, path, message }) => {
    expect(issues(map)).toEqual([{ path, message }]);
  });

  /** The valid grids every rule must let through, including each rule's in-range boundary. */
  const ACCEPT_CASES: readonly { name: string; map: Record<string, unknown> }[] = [
    { name: 'a map carrying every optional lane', map: base() },
    {
      name: 'a bare grid with no optional lanes',
      map: { width: 4, height: 3, typeIds: PER_CELL_LANE },
    },
    {
      name: 'a placement on the last half-cell node naming the last type index',
      map: {
        ...base(),
        objects: {
          types: OBJECT_TYPES,
          placements: [HALF_CELL_X_BOUND - 1, HALF_CELL_Y_BOUND - 1, OBJECT_TYPES.length - 1],
          levels: [1],
        },
      },
    },
    {
      name: 'an objects layer without the optional levels lane',
      map: { ...base(), objects: { types: OBJECT_TYPES, placements: PLACEMENTS } },
    },
    {
      name: 'an objects layer that places nothing',
      map: { ...base(), objects: { types: [], placements: [], levels: [] } },
    },
    {
      name: 'transition lanes that are all TRANSITION_NONE over an empty types dictionary',
      map: {
        ...base(),
        transitions: {
          types: [],
          a1: transitionLane(),
          b1: transitionLane(),
          a2: transitionLane(),
          b2: transitionLane(),
        },
      },
    },
  ];

  it.each(ACCEPT_CASES)('accepts $name', ({ map }) => {
    expect(issues(map)).toEqual([]);
  });

  it('reports every broken lane at once, in invariant-table order (ground before objects)', () => {
    expect(
      issues({
        ...base(),
        ground: { ...GROUND, a: GROUND.a.slice(0, -1) },
        objects: { ...OBJECTS, levels: [1] },
      }),
    ).toEqual([
      { path: 'ground', message: 'terrain map ground lanes must be width*height (12) cells' },
      {
        path: 'objects.levels',
        message: 'terrain map objects.levels must carry one entry per placement triple',
      },
    ]);
  });
});
