import type { SpriteLayer, TextureSource } from '@open-northland/render';
import { describe, expect, it, vi } from 'vitest';
import type { BuildingBobRow, ContentIr } from '../src/content/ir/rows.js';

/**
 * The building sheet's two-pass load. The first reduction says which family pages the winning rows draw
 * from; the pages are fetched; the second reduction runs over only the ones that arrived, so a type whose
 * page is missing falls back to the base tribe's bob instead of indexing a stranger's frame id.
 */

const VIKING = 1;
const SARACEN = 4;
const SARACEN_BMD = 'data/engine2d/bin/bobs/ls_houses_saracen.bmd';
const SARACEN_LAYER = 'ls_houses_saracen.house_saracen01';

/** Which layers the stub serves; anything else 404s the way an undecoded page does. */
const served = vi.hoisted(() => ({ layers: new Set<string>() }));

vi.mock('../src/content/ir/load.js', async () => {
  class MissingAtlasError extends Error {}
  return {
    MissingAtlasError,
    loadLayer: (layer: string): Promise<SpriteLayer> => {
      if (!served.layers.has(layer)) return Promise.reject(new MissingAtlasError(layer));
      return Promise.resolve({
        source: {} as TextureSource,
        atlas: { width: 1, height: 1, frames: new Map() },
      });
    },
  };
});

const { loadBuildingSheet } = await import('../src/content/sprite-sheet/buildings.js');

function bob(tribeId: number, typeId: number, bobId: number, over: Partial<BuildingBobRow> = {}) {
  return {
    tribeId,
    typeId,
    level: 0,
    bmd: 'data/engine2d/bin/bobs/ls_houses_viking.bmd',
    paletteName: 'house01',
    bobId,
    ...over,
  };
}

const ir: ContentIr = {
  buildingBobs: [
    bob(VIKING, 13, 70),
    bob(SARACEN, 13, 12, { bmd: SARACEN_BMD, paletteName: 'house_saracen01' }),
  ],
};

describe('loadBuildingSheet', () => {
  it('binds a tribe its own bob when its family page loads', async () => {
    served.layers = new Set([SARACEN_LAYER]);
    const sheet = await loadBuildingSheet(ir, [VIKING, SARACEN], new Map());
    expect(sheet.families[SARACEN_LAYER]).toBeDefined();
    expect(sheet.binding.byTribe?.[SARACEN]?.byType[13]).toEqual({ layer: SARACEN_LAYER, bob: 12 });
  });

  it('rebuilds the binding without a page that 404s, so the type falls back to the base bob', async () => {
    served.layers = new Set();
    const sheet = await loadBuildingSheet(ir, [VIKING, SARACEN], new Map());
    expect(sheet.families[SARACEN_LAYER]).toBeUndefined();
    // The saracen row is gone rather than pointing into a page nobody loaded; the resolver then reads
    // the base tribe's table for the same type.
    expect(sheet.binding.byTribe?.[SARACEN]?.byType[13]).toBeUndefined();
    expect(sheet.binding.byTribe?.[VIKING]?.byType[13]).toBe(70);
  });

  it('fetches only the pages the winning rows draw from', async () => {
    served.layers = new Set([SARACEN_LAYER]);
    const sheet = await loadBuildingSheet(ir, [VIKING], new Map());
    // A viking-only world must not pay for the saracen family at all.
    expect(Object.keys(sheet.families)).toEqual([]);
  });
});
