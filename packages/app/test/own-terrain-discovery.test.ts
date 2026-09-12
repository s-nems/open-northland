import { readFileSync } from 'node:fs';
import { collectTerrainMaterials } from '@open-northland/art-contracts';
import { describe, expect, it } from 'vitest';
import { ownMaterialUrls, ownTerrainMaterials } from '../src/content/own-assets/materials.js';

const material = {
  id: 'mud',
  image: 'new-mud.png',
  tint: [1, 1, 1],
  wear: 0,
  pages: ['mud-page'],
  names: ['mud-ground'],
  transitions: ['mud-edge'],
};
const manifest = { sourceBasis: 'Synthetic fixture', materials: [material] };

describe('terrain material discovery', () => {
  it('retains every delivered material and its calibration, excluding legacy bindings', () => {
    const expected = ['materials.json', 'rock-materials.json', 'sand-materials.json'].flatMap((name) => {
      const raw: unknown = JSON.parse(
        readFileSync(new URL(`../src/assets/own/terrain/${name}`, import.meta.url), 'utf8'),
      );
      return collectTerrainMaterials([raw]);
    });
    expect(ownTerrainMaterials).toEqual(expect.arrayContaining(expected));
    for (const entry of expected) expect(ownMaterialUrls.has(entry.image)).toBe(true);
  });
  it('accepts a new image basename without extending a filename enum', () => {
    expect(collectTerrainMaterials([manifest], new Set(['new-mud.png']))).toEqual([material]);
  });
  it('rejects a missing image', () => {
    expect(() => collectTerrainMaterials([manifest], new Set())).toThrow('Missing terrain material image');
  });
  it.each([
    '../mud.png',
    '/mud.png',
    'nested/mud.png',
    'mud.jpg',
    'https://example.com/mud.png',
  ])('rejects an image outside the flat PNG delivery: %s', (image) => {
    expect(() => collectTerrainMaterials([{ ...manifest, materials: [{ ...material, image }] }])).toThrow();
  });
  it.each([
    'id',
    'pages',
    'names',
    'transitions',
  ] as const)('rejects duplicate %s across manifests', (field) => {
    const other = {
      id: 'other',
      image: 'other.png',
      tint: [1, 1, 1],
      wear: 0,
      pages: [],
      names: [],
      transitions: [],
    };
    expect(() =>
      collectTerrainMaterials([
        manifest,
        { ...manifest, materials: [{ ...other, [field]: material[field] }] },
      ]),
    ).toThrow('Duplicate binding');
  });
});
