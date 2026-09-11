import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GfxPattern, GfxPatternTransition, parseTerrainMap, TRANSITION_NONE } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ownMaterialBindings } from '../../src/content/own-assets/material-layout.js';
import { ownTerrainMaterials } from '../../src/content/own-assets/materials.js';
import { contentDir, hasRealIr, rawIrUnderTest } from './helpers.js';

const path = resolve(contentDir(), 'maps/magiczny_las.json');

describe.runIf(hasRealIr() && existsSync(path))('own meadow on Magiczny Las', () => {
  it('covers the complete sand family without claiming unrelated patterns on its shared page', () => {
    const ir = z
      .object({ gfxPatterns: z.array(GfxPattern), gfxPatternTransitions: z.array(GfxPatternTransition) })
      .parse(rawIrUnderTest());
    const bindings = ownMaterialBindings(ir.gfxPatterns, ir.gfxPatternTransitions, ownTerrainMaterials);
    const sand = ir.gfxPatterns.filter((row) => row.editGroups.includes('sand all'));
    expect(sand).toHaveLength(97);
    for (const row of ir.gfxPatterns) {
      expect(bindings.ground.get(row.editName ?? '')?.pageKey === 'own-sand', row.editName).toBe(
        sand.includes(row),
      );
    }
    for (const name of ['sand 1', 'sand 2']) {
      const binding = bindings.transitions.get(name);
      expect(binding?.pageKey).toBe('own-sand');
      expect(binding?.coordsA).toHaveLength(6);
      expect(binding?.coordsB).toHaveLength(6);
      for (const coords of [...(binding?.coordsA ?? []), ...(binding?.coordsB ?? [])]) {
        expect(coords).toHaveLength(6);
        expect(coords.every(Number.isFinite)).toBe(true);
      }
    }
  });
  it('covers mountain ground and both six-pair gravel borders from real metadata', () => {
    const ir = z
      .object({ gfxPatterns: z.array(GfxPattern), gfxPatternTransitions: z.array(GfxPatternTransition) })
      .parse(rawIrUnderTest());
    const bindings = ownMaterialBindings(ir.gfxPatterns, ir.gfxPatternTransitions, ownTerrainMaterials);
    const mountains = ir.gfxPatterns.filter((row) => row.editGroups.includes('mountain all'));
    expect(mountains).toHaveLength(112);
    for (const row of mountains) {
      const binding = bindings.ground.get(row.editName ?? '');
      expect(binding?.pageKey, row.editName).toBe('own-mountains');
      expect(binding?.coordsA).toHaveLength(6);
      expect(binding?.coordsB).toHaveLength(6);
    }
    for (const name of ['mountain 1', 'mountain 2']) {
      const binding = bindings.transitions.get(name);
      expect(binding?.pageKey).toBe('own-gravel');
      expect(binding?.coordsA).toHaveLength(6);
      expect(binding?.coordsB).toHaveLength(6);
    }
    const map = parseTerrainMap(JSON.parse(readFileSync(path, 'utf8')));
    if (!map.ground) throw new Error('Missing mountain ground');
    const point = (coords: readonly number[], offset: number) => [
      ((((coords[offset] ?? 0) - 136) % 1088) + 1088) % 1088,
      ((((coords[offset + 1] ?? 0) - 136) % 836) + 836) % 836,
    ];
    // This intact real-map run crosses the last overlapping page back to the first.
    for (let x = 80; x < 94; x++) {
      const leftName = map.ground.patterns[map.ground.b[24 * map.width + x] ?? -1];
      const rightName = map.ground.patterns[map.ground.b[24 * map.width + x + 1] ?? -1];
      const left = bindings.ground.get(leftName ?? '');
      const right = bindings.ground.get(rightName ?? '');
      if (!left || !right) throw new Error('Missing real mountain pair');
      expect(point(left.coordsB, 2)).toEqual(point(right.coordsB, 0));
    }
  });
  it('covers every ground triangle and active overlay in the review clearing', () => {
    const map = parseTerrainMap(JSON.parse(readFileSync(path, 'utf8')));
    const ir = z
      .object({ gfxPatterns: z.array(GfxPattern), gfxPatternTransitions: z.array(GfxPatternTransition) })
      .parse(rawIrUnderTest());
    const bindings = ownMaterialBindings(ir.gfxPatterns, ir.gfxPatternTransitions, ownTerrainMaterials);
    if (!map.ground || !map.transitions) throw new Error('Review map needs ground and transition lanes');
    let overlays = 0;
    const materials = new Set<string>();
    for (let y = 33; y < 45; y++)
      for (let x = 42; x < 54; x++) {
        const index = y * map.width + x;
        for (const lane of [map.ground.a, map.ground.b]) {
          const pattern = lane[index];
          const name = pattern === undefined ? undefined : map.ground.patterns[pattern];
          const binding = name === undefined ? undefined : bindings.ground.get(name);
          expect(binding, `ground at ${x},${y}`).toBeDefined();
          if (binding) materials.add(binding.pageKey);
        }
        for (const lane of [map.transitions.a1, map.transitions.b1, map.transitions.a2, map.transitions.b2]) {
          const value = lane[index];
          if (value === undefined || value === TRANSITION_NONE) continue;
          const name = map.transitions.types[Math.floor(value / 6)];
          const binding = name === undefined ? undefined : bindings.transitions.get(name);
          expect(binding, `overlay at ${x},${y}`).toBeDefined();
          expect(binding?.coordsA[value % 6]).toHaveLength(6);
          expect(binding?.coordsB[value % 6]).toHaveLength(6);
          overlays++;
        }
      }
    expect(materials).toEqual(new Set(['own-meadow', 'own-earth']));
    expect(overlays).toBe(26);
  });
});
