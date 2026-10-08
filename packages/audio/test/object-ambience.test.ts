import type { SoundBank } from '@open-northland/data';
import type { Camera } from '@open-northland/render/data';
import {
  type EntityDelta,
  type EntitySnapshot,
  ONE,
  packSnapshotDelta,
  SnapshotMirror,
  type WorldSnapshot,
} from '@open-northland/sim';
import { describe, expect, it, vi } from 'vitest';
import { poolGain } from '../src/data/bank.js';
import { objectAmbienceShots } from '../src/data/director/object-ambience.js';
import { scenerySectors } from '../src/data/landscape-sectors.js';
import {
  type AudioTerrain,
  authoredVolumeGain,
  buildSoundIndex,
  computeSpatial,
  DEFAULT_AUTHORED_VOLUME,
  type DirectorInput,
  defaultBindings,
  LANDSCAPE_CHANCE_RANGE,
  LANDSCAPE_SECTOR_TILES,
  type LandscapeSectors,
  landscapeSectorsOf,
  MAX_LANDSCAPE_TICKS_PER_FRAME,
  type SceneryObject,
} from '../src/index.js';

/**
 * The object ambience: the sound data's landscape-group one-shots, rolled per tick over the landscape
 * objects on screen at the original's rate and sounded at one of them.
 */

const BIRD_VOLUME = 70;
const QUIET_BIRD_VOLUME = 30;
const BIRD_CHANCE = 5;
const QUIET_BIRD_CHANCE = 3;
const WEIGHT = 10;
const SIREN_VOLUME = 80;
const SIREN_CHANCE = 10;

const YEW_RECORD = 7;
const SIREN_RECORD = 9;
const DECOR_RECORD = 11;

const bank: SoundBank = {
  staticGroups: [],
  ambient: [
    {
      name: 'Meadow Green',
      patternGroups: ['meadow green'],
      landscapeGroups: [],
      sfx: [{ file: 'ambient/meadow1.wav', params: [0, 0, 0] }],
    },
    {
      name: 'All Trees',
      patternGroups: [],
      landscapeGroups: ['trees yew'],
      sfx: [
        { file: 'ambient/bird_01.wav', params: [WEIGHT, BIRD_VOLUME, BIRD_CHANCE] },
        { file: 'static/dummy.wav', params: [WEIGHT, BIRD_VOLUME, BIRD_CHANCE] },
        { file: 'ambient/bird_02.wav', params: [WEIGHT, BIRD_VOLUME, BIRD_CHANCE] },
        { file: 'ambient/bird_03.wav', params: [WEIGHT, QUIET_BIRD_VOLUME, QUIET_BIRD_CHANCE] },
      ],
    },
    {
      name: 'Sirens',
      patternGroups: [],
      landscapeGroups: ['misc_sirens'],
      sfx: [{ file: 'ambient/sirens_01.wav', params: [WEIGHT, SIREN_VOLUME, SIREN_CHANCE] }],
    },
  ],
  jingles: [],
  humanVoices: [],
  animalCalls: [],
};
const index = buildSoundIndex(
  bank,
  [],
  [],
  [],
  [],
  [
    { index: YEW_RECORD, editGroups: ['trees all', 'Trees Yew'] },
    { index: SIREN_RECORD, editGroups: ['misc_sirens'] },
    { index: DECOR_RECORD, editGroups: ['misc_signs'] },
  ],
);

const CANVAS_W = 1920;
const CANVAS_H = 1080;
const camera: Camera = { offsetX: 0, offsetY: 0, scale: 1 };
const MAP_SIDE = 60;
const terrain: AudioTerrain = {
  width: MAP_SIDE,
  height: MAP_SIDE,
  typeIds: new Array<number>(MAP_SIDE ** 2).fill(0),
};
/** A row in the screen's middle band, and a column on each side of the screen centre. */
const ROW = 10;
const LEFT_COL = 4;
const RIGHT_COL = 24;

function tree(id: number, col: number, row: number, record = YEW_RECORD): EntitySnapshot {
  return {
    id,
    components: {
      Position: { x: col * ONE, y: row * ONE },
      Resource: { goodType: 1, remaining: 3, harvestAtomic: 24, gfxIndex: record },
    },
  };
}

function forest(count: number, col = LEFT_COL): EntitySnapshot[] {
  return Array.from({ length: count }, (_, i) => tree(i + 1, col, ROW));
}

/** A roll source handing out `values` in turn, repeating the last. */
function rolls(...values: number[]): () => number {
  let at = 0;
  return () => values[Math.min(at++, values.length - 1)] ?? 0;
}

function input(
  entities: readonly EntitySnapshot[],
  random: () => number,
  extra: Partial<DirectorInput> & { readonly ticks?: number; readonly scenery?: LandscapeSectors } = {},
): DirectorInput {
  const { ticks = 1, scenery, ...rest } = extra;
  return {
    events: [],
    snapshot: { tick: 1, entities: [...entities], events: [] },
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    terrain,
    index,
    bindings: defaultBindings(),
    landscape: { ticks, random, ...(scenery !== undefined ? { scenery } : {}) },
    ...rest,
  };
}

/** The first pool's pick, a chance roll just inside the screen's rate and the first object. */
const FIRST_POOL = 0;
const FIRST_OBJECT = 0;
const LAST_OBJECT = 0.999;
const EDGE = 1e-6;

describe('landscape ambience join', () => {
  it('reads each line as weight, volume, chance and pools the wavs of equal triples', () => {
    const trees = index.landscapeAmbienceByRecord.get(YEW_RECORD);
    expect(trees?.name).toBe('All Trees');
    expect(trees?.pools.map(({ files, weight, chance }) => ({ files, weight, chance }))).toEqual([
      { files: ['ambient/bird_01.wav', 'ambient/bird_02.wav'], weight: 2 * WEIGHT, chance: BIRD_CHANCE },
      { files: ['ambient/bird_03.wav'], weight: WEIGHT, chance: QUIET_BIRD_CHANCE },
    ]);
    expect(trees?.weight).toBe(3 * WEIGHT);
    const [loud, quiet] = trees?.pools ?? [];
    expect(loud && poolGain(index, loud.files)).toBe(authoredVolumeGain(BIRD_VOLUME));
    expect(quiet && poolGain(index, quiet.files)).toBe(authoredVolumeGain(QUIET_BIRD_VOLUME));
  });

  it('joins a record by any of its edit groups, case-insensitively, and leaves the rest out', () => {
    expect(index.landscapeAmbienceByRecord.get(SIREN_RECORD)?.name).toBe('Sirens');
    expect(index.landscapeAmbienceByRecord.has(DECOR_RECORD)).toBe(false);
    // A pattern bed's `0 0 0` stays a bed, never an object ambience.
    expect(index.ambientLoopByName.get('Meadow Green')).toBe('ambient/meadow1.wav');
    expect([...index.landscapeAmbienceByRecord.values()].map((a) => a.name)).not.toContain('Meadow Green');
  });

  it('builds no object ambience without landscape records', () => {
    expect(buildSoundIndex(bank, [], []).landscapeAmbienceByRecord.size).toBe(0);
  });
});

describe('object ambience', () => {
  const TREES = 40;
  /** 40 trees at chance 5 in 10,000: the original's 2 % per tick. */
  const rate = (TREES * BIRD_CHANCE) / LANDSCAPE_CHANCE_RANGE;

  it("fires at the screen's object count times the picked pool's chance per tick", () => {
    expect(
      objectAmbienceShots(input(forest(TREES), rolls(FIRST_POOL, rate - EDGE, FIRST_OBJECT))),
    ).toHaveLength(1);
    expect(objectAmbienceShots(input(forest(TREES), rolls(FIRST_POOL, rate + EDGE, FIRST_OBJECT)))).toEqual(
      [],
    );
    // The quieter pool, a third of the weight, rolls its own lower chance.
    const quietPick = 2 / 3 + EDGE;
    const quietRate = (TREES * QUIET_BIRD_CHANCE) / LANDSCAPE_CHANCE_RANGE;
    const [quiet] = objectAmbienceShots(
      input(forest(TREES), rolls(quietPick, quietRate - EDGE, FIRST_OBJECT)),
    );
    expect(quiet?.files).toEqual(['ambient/bird_03.wav']);
    expect(
      objectAmbienceShots(input(forest(TREES), rolls(quietPick, quietRate + EDGE, FIRST_OBJECT))),
    ).toEqual([]);
  });

  it('sounds at a random object of the ambience, at its authored volume, on the world sfx lane', () => {
    const entities = [tree(1, LEFT_COL, ROW), tree(2, RIGHT_COL, ROW)];
    const [left] = objectAmbienceShots(input(entities, rolls(FIRST_POOL, 0, FIRST_OBJECT)));
    const [right] = objectAmbienceShots(input(entities, rolls(FIRST_POOL, 0, LAST_OBJECT)));
    const leftSpatial = computeSpatial(LEFT_COL, ROW, camera, CANVAS_W, CANVAS_H);
    const rightSpatial = computeSpatial(RIGHT_COL, ROW, camera, CANVAS_W, CANVAS_H);
    expect(left?.pan).toBe(leftSpatial?.pan);
    expect(left?.pan).toBeLessThan(0);
    expect(right?.pan).toBe(rightSpatial?.pan);
    expect(right?.pan).toBeGreaterThan(0);
    expect(left?.gain).toBeCloseTo((leftSpatial?.gain ?? 0) * authoredVolumeGain(BIRD_VOLUME));
    expect(authoredVolumeGain(BIRD_VOLUME)).toBeLessThan(authoredVolumeGain(DEFAULT_AUTHORED_VOLUME));
    expect(left?.lane).toEqual({ kind: 'sfx' });
    expect(left?.layer).toBeUndefined(); // the detail layer
  });

  it('sounds at an object on explored ground out of sight, never at one the viewer never explored', () => {
    const sure = (): number => 0;
    const greyed = input(forest(TREES), sure, { visibleTile: () => false });
    expect(objectAmbienceShots(greyed)).toHaveLength(1);
    const unexplored = input(forest(TREES), sure, { exploredTile: () => false });
    expect(objectAmbienceShots(unexplored)).toEqual([]);
  });

  it('counts no object off screen', () => {
    const farCol = MAP_SIDE - 1;
    const farRow = MAP_SIDE - 1;
    const offScreen = [tree(1, farCol, farRow)];
    expect(objectAmbienceShots(input(offScreen, rolls(FIRST_POOL, 0, FIRST_OBJECT)))).toEqual([]);
  });

  it('rolls once per elapsed tick, up to its cap, and not on a frame that advanced none', () => {
    const always = rolls(FIRST_POOL, 0, FIRST_OBJECT, FIRST_POOL, 0, FIRST_OBJECT, 0);
    expect(objectAmbienceShots(input(forest(TREES), always, { ticks: 0 }))).toEqual([]);
    const sure = (): number => 0;
    expect(objectAmbienceShots(input(forest(TREES), sure, { ticks: 3 }))).toHaveLength(3);
    expect(objectAmbienceShots(input(forest(TREES), sure, { ticks: 100 }))).toHaveLength(
      MAX_LANDSCAPE_TICKS_PER_FRAME,
    );
  });

  it("keeps a 1:1 screen's rate on a zoomed-out view", () => {
    const half = 0.5;
    const zoomed = { camera: { ...camera, scale: half } };
    const density = half ** 2;
    expect(
      objectAmbienceShots(input(forest(TREES), rolls(FIRST_POOL, rate * density - EDGE, 0), zoomed)),
    ).toHaveLength(1);
    expect(
      objectAmbienceShots(input(forest(TREES), rolls(FIRST_POOL, rate * density + EDGE, 0), zoomed)),
    ).toEqual([]);
  });

  it('tallies again for another sound index over the same objects', () => {
    const framing = input(forest(TREES), rolls(FIRST_POOL, 0, FIRST_OBJECT));
    expect(objectAmbienceShots(framing)[0]?.files).toEqual(['ambient/bird_01.wav', 'ambient/bird_02.wav']);
    const sirensInYews = buildSoundIndex(
      bank,
      [],
      [],
      [],
      [],
      [{ index: YEW_RECORD, editGroups: ['misc_sirens'] }],
    );
    const landscape = { ticks: 1, random: rolls(FIRST_POOL, 0, FIRST_OBJECT) };
    const [siren] = objectAmbienceShots({ ...framing, index: sirensInYews, landscape });
    expect(siren?.files).toEqual(['ambient/sirens_01.wav']);
  });

  it("sounds the map's scenery, keeping only the records that have a sound", () => {
    const placements: SceneryObject[] = [
      { id: 0, record: SIREN_RECORD, hx: 2 * RIGHT_COL, hy: 2 * ROW },
      { id: 1, record: DECOR_RECORD, hx: 2 * LEFT_COL, hy: 2 * ROW },
    ];
    const scenery = scenerySectors(placements, (record) => index.landscapeAmbienceByRecord.has(record));
    expect([...scenery.sectors.values()].flatMap((s) => [...s.keys()])).toEqual([SIREN_RECORD]);
    const [siren] = objectAmbienceShots(input([], rolls(FIRST_POOL, 0, FIRST_OBJECT), { scenery }));
    expect(siren?.files).toEqual(['ambient/sirens_01.wav']);
    expect(siren?.pan).toBeGreaterThan(0);
  });
});

describe('landscape sectors over a mirror', () => {
  function mirrorOf(entities: readonly EntitySnapshot[]): SnapshotMirror {
    const mirror = new SnapshotMirror();
    const touched = entities.map((e) => ({ id: e.id, components: e.components, removed: [] }));
    mirror.apply(
      packSnapshotDelta({ tick: 1, sequence: 0, rebuild: true, touched, removed: [], events: [] }),
    );
    return mirror;
  }

  function advance(
    mirror: SnapshotMirror,
    touched: readonly EntityDelta[],
    removed: readonly number[],
  ): void {
    const tick = mirror.tick ?? 0;
    mirror.apply(
      packSnapshotDelta({ tick: tick + 1, sequence: tick, rebuild: false, touched, removed, events: [] }),
    );
  }

  const count = (snapshot: WorldSnapshot): number => {
    let n = 0;
    for (const sector of landscapeSectorsOf(snapshot).sectors.values()) {
      for (const objects of sector.values()) n += objects.size;
    }
    return n;
  };

  it('drops a felled tree, keeps a struck one and takes a planted one per change', () => {
    const mirror = mirrorOf([tree(1, LEFT_COL, ROW), tree(2, RIGHT_COL, ROW)]);
    expect(count(mirror.snapshot())).toBe(2);
    const struck: EntityDelta = {
      id: 2,
      components: {
        Resource: { goodType: 1, remaining: 2, harvestAtomic: 24, gfxIndex: YEW_RECORD, strikes: 1 },
      },
      removed: [],
    };
    const planted = tree(3, RIGHT_COL, ROW + LANDSCAPE_SECTOR_TILES);
    advance(mirror, [struck, { id: planted.id, components: planted.components, removed: [] }], [1]);
    expect(count(mirror.snapshot())).toBe(2);
    expect(mirror.verifyIndexes()).toEqual([]);
  });

  it("reads an object's position only on placement, so a position write replaces nothing", () => {
    const mirror = mirrorOf([tree(1, LEFT_COL, ROW)]);
    const before = landscapeSectorsOf(mirror.snapshot()).revision;
    const moved: EntityDelta = {
      id: 1,
      components: { Position: { x: RIGHT_COL * ONE, y: (ROW + LANDSCAPE_SECTOR_TILES) * ONE } },
      removed: [],
    };
    advance(mirror, [moved], []);
    expect(landscapeSectorsOf(mirror.snapshot()).revision).toBe(before);
  });
});

describe('object ambience cost', () => {
  /** One tree in every sector of a `side`-tile map. */
  function sectorForest(side: number): EntitySnapshot[] {
    const out: EntitySnapshot[] = [];
    let id = 1;
    for (let row = 0; row < side; row += LANDSCAPE_SECTOR_TILES) {
      for (let col = 0; col < side; col += LANDSCAPE_SECTOR_TILES) out.push(tree(id++, col, row));
    }
    return out;
  }

  function sectorReads(side: number, frames: readonly Camera[]): number[] {
    const snapshot: WorldSnapshot = { tick: 1, entities: sectorForest(side), events: [] };
    const grid: AudioTerrain = { width: side, height: side, typeIds: [] };
    const live = landscapeSectorsOf(snapshot);
    const reads = vi.spyOn(live.sectors, 'get');
    return frames.map((frameCamera) => {
      reads.mockClear();
      objectAmbienceShots({ ...input([], () => 1), snapshot, terrain: grid, camera: frameCamera });
      return reads.mock.calls.length;
    });
  }

  it('reads the visible sectors once per framing, whatever the map holds beyond them', () => {
    const SMALL = 100;
    const HUGE = 1000;
    const nudged = { ...camera, offsetX: camera.offsetX - 1 };
    const [small] = sectorReads(SMALL, [camera]);
    const [huge, again, panned] = sectorReads(HUGE, [camera, camera, nudged]);
    expect(small).toBeGreaterThan(0);
    expect(huge).toBe(small);
    // The same framing, and a pan inside one sector band, reuse the tally.
    expect(again).toBe(0);
    expect(panned).toBe(0);
    const screenSectors = Math.ceil(SMALL / LANDSCAPE_SECTOR_TILES) ** 2;
    expect(huge).toBeLessThanOrEqual(screenSectors);
  });
});
