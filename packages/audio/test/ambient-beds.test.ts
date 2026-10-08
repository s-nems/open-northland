import type { GfxPattern, SoundBank } from '@open-northland/data';
import { type Camera, tileToScreen } from '@open-northland/render/data';
import { describe, expect, it } from 'vitest';
import { ambientBeds } from '../src/data/director/ambient.js';
import {
  AmbientBedMemory,
  type AudioTerrain,
  BED_SWAP_HOLD_S,
  BED_SWAP_LEAD,
  buildSoundIndex,
  type DirectorInput,
  defaultBindings,
  MAX_AMBIENT_BEDS,
} from '../src/index.js';

/** The bed choice across frames: a playing bed holds against small changes, and a still framing reuses
 *  its sampled coverage. */

const bed = (name: string, group: string) => ({
  name,
  patternGroups: [group],
  landscapeGroups: [],
  sfx: [{ file: `ambient/${name}.wav`, params: [0, 0, 0] }],
});
const BED_NAMES = ['water', 'forest', 'meadow', 'beach'] as const;
type BedName = (typeof BED_NAMES)[number];
const bank: SoundBank = {
  staticGroups: [],
  ambient: BED_NAMES.map((name) => bed(name, `${name} group`)),
  jingles: [],
  humanVoices: [],
  animalCalls: [],
};
const patterns = BED_NAMES.map((name, id) => ({ id, editName: name, editGroups: [`${name} group`] }));
const index = buildSoundIndex(bank, patterns as unknown as GfxPattern[], []);

const SIDE = 10;
const CELLS = SIDE * SIDE;
const CANVAS_W = 800;
const CANVAS_H = 600;
const centre = tileToScreen(SIDE / 2, SIDE / 2);
const camera: Camera = { offsetX: CANVAS_W / 2 - centre.x, offsetY: CANVAS_H / 2 - centre.y, scale: 1 };

/** A ground of `cells` cells per bed, in a row-major run; both triangles of a cell carry its bed. */
function groundOf(cells: Readonly<Record<BedName, number>>): AudioTerrain {
  const slots: number[] = [];
  BED_NAMES.forEach((name, slot) => {
    for (let i = 0; i < cells[name]; i++) slots.push(slot);
  });
  expect(slots).toHaveLength(CELLS);
  return {
    width: SIDE,
    height: SIDE,
    typeIds: new Array<number>(CELLS).fill(0),
    ground: { patterns: [...BED_NAMES], a: slots, b: slots },
  };
}

function frame(terrain: AudioTerrain, extra: Partial<DirectorInput> = {}): DirectorInput {
  return {
    events: [],
    snapshot: { tick: 1, entities: [], events: [] },
    camera,
    canvasW: CANVAS_W,
    canvasH: CANVAS_H,
    index,
    bindings: defaultBindings(),
    terrain,
    ...extra,
  };
}

const names = (input: DirectorInput): string[] => ambientBeds(input).map((b) => b.name);

/** The beach plays third; the meadow ranks fourth, just behind it. */
const BEACH_THIRD = groundOf({ water: 40, forest: 25, beach: 18, meadow: 17 });
/** The meadow edges past the beach by a cell. */
const MEADOW_EDGES_AHEAD = groundOf({ water: 40, forest: 25, beach: 17, meadow: 18 });
/** The meadow leads the beach by more than {@link BED_SWAP_LEAD}. */
const MEADOW_LEADS = groundOf({ water: 40, forest: 25, beach: 12, meadow: 23 });

describe('ambient bed hysteresis', () => {
  it('keeps a playing bed when the bed behind it edges ahead', () => {
    const memory = new AmbientBedMemory();
    const at = (now: number, terrain: AudioTerrain) => names(frame(terrain, { beds: { now, memory } }));
    expect(at(0, BEACH_THIRD)).toEqual(['water', 'forest', 'beach']);
    expect(at(1, MEADOW_EDGES_AHEAD)).toEqual(['water', 'forest', 'beach']);
    // Stateless, the cut follows the frame's ranking.
    expect(names(frame(MEADOW_EDGES_AHEAD))).toEqual(['water', 'forest', 'meadow']);
  });

  it('swaps at once for a bed that leads by the swap margin', () => {
    expect(23 / 12).toBeGreaterThan(BED_SWAP_LEAD);
    const memory = new AmbientBedMemory();
    names(frame(BEACH_THIRD, { beds: { now: 0, memory } }));
    expect(names(frame(MEADOW_LEADS, { beds: { now: 0.1, memory } }))).toEqual(['water', 'forest', 'meadow']);
  });

  it('swaps for a bed that has ranked among the loudest for the hold time', () => {
    const memory = new AmbientBedMemory();
    const at = (now: number) => names(frame(MEADOW_EDGES_AHEAD, { beds: { now, memory } }));
    names(frame(BEACH_THIRD, { beds: { now: 0, memory } }));
    const ahead = 1;
    expect(at(ahead)).toContain('beach');
    expect(at(ahead + BED_SWAP_HOLD_S / 2)).toContain('beach');
    expect(at(ahead + BED_SWAP_HOLD_S)).toEqual(['water', 'forest', 'meadow']);
  });

  it('restarts the hold when the challenger drops back', () => {
    const memory = new AmbientBedMemory();
    const at = (now: number, terrain: AudioTerrain) => names(frame(terrain, { beds: { now, memory } }));
    at(0, BEACH_THIRD);
    at(1, MEADOW_EDGES_AHEAD);
    at(2, BEACH_THIRD);
    expect(at(1 + BED_SWAP_HOLD_S, MEADOW_EDGES_AHEAD)).toContain('beach');
  });

  it('fills a free slot at once and plays no more than the cap', () => {
    const memory = new AmbientBedMemory();
    const waterOnly = groundOf({ water: 100, forest: 0, beach: 0, meadow: 0 });
    expect(names(frame(waterOnly, { beds: { now: 0, memory } }))).toEqual(['water']);
    const beds = names(frame(MEADOW_LEADS, { beds: { now: 0, memory } }));
    expect(beds).toHaveLength(MAX_AMBIENT_BEDS);
    expect(beds).toEqual(['water', 'forest', 'meadow']);
  });
});

describe('ambient bed sampling cache', () => {
  function counting() {
    let calls = 0;
    return {
      explored: () => {
        calls++;
        return true;
      },
      take: () => {
        const n = calls;
        calls = 0;
        return n;
      },
    };
  }

  it('samples a still framing once per fog revision', () => {
    const memory = new AmbientBedMemory();
    const fog = counting();
    const at = (fogRevision: number, view = camera) =>
      ambientBeds(
        frame(BEACH_THIRD, {
          camera: view,
          exploredTile: fog.explored,
          beds: { now: 0, memory, fogRevision },
        }),
      );
    const first = at(1);
    expect(fog.take()).toBeGreaterThan(0);
    expect(at(1)).toEqual(first);
    expect(fog.take()).toBe(0);
    at(2);
    expect(fog.take()).toBeGreaterThan(0);
    at(2, { ...camera, offsetX: camera.offsetX + 1 });
    expect(fog.take()).toBeGreaterThan(0);
  });

  it('samples every frame when the fog gate comes without a revision', () => {
    const memory = new AmbientBedMemory();
    const fog = counting();
    const at = () =>
      ambientBeds(frame(BEACH_THIRD, { exploredTile: fog.explored, beds: { now: 0, memory } }));
    at();
    fog.take();
    at();
    expect(fog.take()).toBeGreaterThan(0);
  });
});
