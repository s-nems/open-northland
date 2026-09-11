import { GfxPattern, GfxPatternTransition } from '@open-northland/data';
import { describe, expect, it } from 'vitest';
import { ownTerrainBindings } from '../src/content/own-assets/bindings.js';
import {
  MATERIAL_COLUMNS,
  MATERIAL_STRIDE,
  MATERIAL_TILES,
  materialTileCoords,
  ownMaterialBindings,
  TRANSITION_CORNERS,
} from '../src/content/own-assets/material-layout.js';
import { ownTerrainMaterials } from '../src/content/own-assets/materials.js';

function pattern(name: string, page: string, coordsA = [0, 0, 63, 63, 0, 63]) {
  return GfxPattern.parse({
    id: 0,
    editName: name,
    editGroups: [],
    logicType: 2,
    texture: `data/engine2d/bin/textures/${page}.pcx`,
    coordsA,
    coordsB: [0, 0, 63, 0, 63, 63],
    source: { file: 'synthetic', block: 'GfxPattern' },
  });
}

function transition(name: string) {
  return GfxPatternTransition.parse({
    index: 0,
    editName: name,
    pointType: 'synthetic',
    coordsA: Array.from({ length: 6 }, () => [0, 0, 63, 63, 0, 63]),
    coordsB: Array.from({ length: 6 }, () => [0, 0, 63, 0, 63, 63]),
    source: { file: 'synthetic', block: 'transition' },
  });
}

describe('own meadow material pack', () => {
  it('keeps mountain ridges continuous across triangle, row and source-page boundaries', () => {
    const names = [
      'block mountain 00 02 00',
      'block mountain 10 00 00',
      'block mountain 00 03 01',
      'block mountain 00 04 03',
      'block mountain 01 02 00',
    ];
    const rows = names.map((name) => pattern(name, 'text_200'));
    const ground = ownMaterialBindings(rows, [], ownTerrainMaterials).ground;
    const bindings = names.map((name) => {
      const binding = ground.get(name);
      if (!binding) throw new Error(`Missing ${name}`);
      return binding;
    });
    const [left, right, below, lastRow, nextPageRow] = bindings;
    expect(left?.coordsB.slice(2, 4)).toEqual(right?.coordsB.slice(0, 2));
    expect(left?.coordsA.slice(2, 4)).toEqual(below?.coordsA.slice(0, 2));
    expect(lastRow?.coordsA.slice(4, 6)).toEqual(nextPageRow?.coordsA.slice(0, 2));
    expect(new Set(bindings.map((b) => b.coordsA.join(','))).size).toBe(names.length);
  });
  it('joins selected pages and exact names without claiming other entries on a shared page', () => {
    const result = ownMaterialBindings(
      [
        pattern('ordinary', 'text_224'),
        pattern('dark', 'text_228'),
        pattern('deep', 'text_237'),
        pattern('mud', 'text_210'),
        pattern('meadow 01', 'text_003'),
        pattern('sand 01', 'text_003'),
        pattern('unbound shared-page terrain', 'text_003'),
        pattern('overlay road', 'text_000'),
        pattern('border', 'text_000'),
        pattern('bad extent', 'text_224', [0, 0, 64, 64, 0, 64]),
      ],
      [],
      ownTerrainMaterials,
    );
    expect([...result.ground].map(([name, value]) => [name, value.pageKey])).toEqual([
      ['ordinary', 'own-meadow'],
      ['meadow 01', 'own-meadow'],
      ['dark', 'own-dark-meadow'],
      ['deep', 'own-deep-meadow'],
      ['overlay road', 'own-earth'],
      ['mud', 'own-mud'],
      ['sand 01', 'own-sand'],
    ]);
  });

  it('retains vertex order when source UVs are reflected', () => {
    const result = ownMaterialBindings(
      [pattern('reflected', 'text_224', [63, 0, 0, 63, 63, 63])],
      [],
      ownTerrainMaterials,
    );
    expect(result.ground.get('reflected')?.coordsA).toEqual([136, 8, 8, 136, 136, 136]);
  });

  it('keeps six directional pairs and both authored variants distinct, with missing overlays visible', () => {
    const result = ownMaterialBindings(
      [],
      [transition('meadow 1'), transition('meadow 2'), transition('water bright 1')],
      ownTerrainMaterials,
    );
    const textures = ownTerrainBindings(new Map(), result.ground, result.transitions);
    const first = textures.transitionFor?.('meadow 1');
    const second = textures.transitionFor?.('meadow 2');
    expect(first?.pageKey).toBe('own-meadow');
    expect(second?.pageKey).toBe('own-meadow');
    expect(first?.coordsA).toHaveLength(6);
    expect(new Set(first?.coordsA.map(String)).size).toBe(6);
    expect(first?.coordsA).not.toEqual(first?.coordsB);
    expect(first?.coordsA).not.toEqual(second?.coordsA);
    expect(textures.transitionFor?.('water bright 1')?.pageKey).toBe('missing-transition');
    expect(TRANSITION_CORNERS.a).toEqual([
      [1, 0, 1],
      [1, 1, 0],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 0],
    ]);
    expect(TRANSITION_CORNERS.b).toEqual([
      [1, 1, 0],
      [1, 0, 1],
      [0, 1, 1],
      [0, 0, 1],
      [0, 1, 0],
      [1, 0, 0],
    ]);
  });

  it('keeps every atlas sample inside its guttered tile', () => {
    for (let tile = 0; tile < MATERIAL_TILES; tile++) {
      for (const lane of ['a', 'b'] as const) {
        for (const [index, value] of materialTileCoords(tile, lane).entries()) {
          expect(value).toBeGreaterThan(0);
          expect(value).toBeLessThan((index % 2 === 0 ? MATERIAL_COLUMNS : 4) * MATERIAL_STRIDE);
        }
      }
    }
  });
});
