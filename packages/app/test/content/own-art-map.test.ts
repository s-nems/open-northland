import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GfxPattern, parseTerrainMap } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ownGrassBindings, ownMapPatch } from '../../src/entries/art-review/map-patch.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

const path = resolve(contentDir(), 'maps/tutorial_005.json');

describe.runIf(hasRealIr() && existsSync(path))('own art on the local tutorial meadow', () => {
  it('covers every used pattern and retains source terrain lanes', () => {
    const map = parseTerrainMap(JSON.parse(readFileSync(path, 'utf8')));
    const ir = z.object({ gfxPatterns: z.array(GfxPattern) }).parse(rawIrUnderTest());
    const patterns = ownGrassBindings(ir.gfxPatterns, 512, 512);
    const patch = ownMapPatch(map, { x: 130, y: 70, width: 18, height: 20 }, patterns);
    expect(patch.names.length).toBeGreaterThan(1);
    for (let row = 0; row < 20; row++)
      for (let col = 0; col < 18; col++) {
        const source = (row + 70) * map.width + col + 130;
        const target = row * 18 + col;
        expect(patch.terrain.ground?.a[target]).toBe(map.ground?.a[source]);
        expect(patch.terrain.ground?.b[target]).toBe(map.ground?.b[source]);
        expect(patch.terrain.typeIds[target]).toBe(map.typeIds[source]);
        expect(patch.terrain.elevation?.[target]).toBe(map.elevation?.[source]);
        expect(patch.terrain.brightness?.[target]).toBe(map.brightness?.[source]);
      }
    for (const binding of patterns.values()) {
      expect(binding.pageKey).toBe('own-grass');
      expect([...binding.coordsA, ...binding.coordsB].every((v) => v >= 0 && v < 512)).toBe(true);
    }
  });
});
