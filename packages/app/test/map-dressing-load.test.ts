import type { AtlasFrame, SpriteLayer, TextureSource } from '@open-northland/render';
import { describe, expect, it, vi } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';

/**
 * The shore-wave and butterfly loaders, over stub atlases: which placements become waves or swarms,
 * with which frames and phase.
 */

const WAVE_STEM = 'test_effect.indexed';
const BUTTERFLY_STEM = 'cr_ani_body_01.butterfly01';
const BUTTERFLIES = 35;
const ADULT_ANIMAL_JOB = 49;
const LOOP_MODE = 1;

function frame(x: number): AtlasFrame {
  return { x, y: 0, width: 4, height: 4, offsetX: 0, offsetY: 0 };
}

/** Bob ids 1..3 draw; bob 9 is an empty 0x0 slot. */
const FRAMES = new Map<number, AtlasFrame>([
  [1, frame(0)],
  [2, frame(4)],
  [3, frame(8)],
  [9, { ...frame(12), width: 0, height: 0 }],
]);

vi.mock('../src/content/ir/load.js', async () => {
  class MissingAtlasError extends Error {}
  return {
    MissingAtlasError,
    loadLayer: (stem: string): Promise<SpriteLayer> =>
      stem === WAVE_STEM || stem === BUTTERFLY_STEM
        ? Promise.resolve({ source: {} as TextureSource, atlas: { width: 16, height: 4, frames: FRAMES } })
        : Promise.reject(new MissingAtlasError(stem)),
  };
});

vi.resetModules();
const { loadGroundWaves } = await import('../src/content/ground-waves.js');
const { loadAmbientCreatures } = await import('../src/content/animal-gfx/ambient.js');

describe('loadGroundWaves', () => {
  const ir: ContentIr = {
    landscapeGfx: [
      {
        index: 0,
        editName: 'fx wave',
        logicType: 1,
        bmd: 'data/engine2d/bin/bobs/test_effect.bmd',
        frames: [{ state: 1, bobIds: [1, 9, 2] }],
        userFxMatrix: true,
      },
      { index: 1, editName: 'palm', logicType: 4, bmd: 'data/ls_trees.bmd', paletteName: 'tree03' },
    ],
  };

  it('makes each displacement placement a wave on its drawable frames, phased x + 2y', async () => {
    const { waves, byPlacement } = await loadGroundWaves(
      { types: ['palm', 'fx wave'], placements: [4, 4, 0, 3, 5, 1] },
      ir,
    );
    expect(waves).toHaveLength(1);
    expect(waves[0]?.frames).toEqual([frame(0), frame(4)]);
    expect(waves[0]?.phase).toBe(3 + 2 * 5);
    expect([...byPlacement.keys()]).toEqual([1]);
  });
});

describe('loadAmbientCreatures', () => {
  const ir: ContentIr = {
    tribes: [{ typeId: BUTTERFLIES, id: 'butterflies' }],
    animals: [{ tribeType: BUTTERFLIES, hitpointsAdult: 0 }],
    gfxAtomics: [
      { tribe: BUTTERFLIES, job: ADULT_ANIMAL_JOB, action: 2, dirFrames: [[3]] },
      { tribe: BUTTERFLIES, job: ADULT_ANIMAL_JOB, action: 3, dirFrames: [[1, 2]], mode: LOOP_MODE },
    ],
  };

  it("draws each authored swarm as a creature looping the species' base loop", async () => {
    const sprites = await loadAmbientCreatures(
      [
        { species: 'butterflies', player: 0, hx: 2, hy: 6 },
        { species: 'hares', player: 0, hx: 1, hy: 1 },
      ],
      ir,
    );
    expect(sprites).toHaveLength(1);
    expect(sprites[0]).toMatchObject({ creature: true, decor: false, phase: 2 + 6 });
    expect(sprites[0]?.frames).toEqual([frame(0), frame(4)]);
  });
});
