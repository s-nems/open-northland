import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { customBushBinding } from '../../src/custom/content/bush-binding.js';
import { customPropManifest } from '../../src/custom/content/prop-manifest.js';

const pack = new URL('../../../../docs/art/terrain/bushes/', import.meta.url);
const manifests = readdirSync(pack)
  .filter((name) => name.endsWith('.runtime.json'))
  .map((name) => customPropManifest.parse(JSON.parse(readFileSync(new URL(name, pack), 'utf8'))));

describe('own berry bush seasonal binding', () => {
  it('carries both species through foraged, flowering and ripe graphics', () => {
    const fallback = { default: 99, byGood: {}, byGfxIndex: { 7: [{ layer: 'fallback', bob: 123 }] } };
    const binding = customBushBinding(
      fallback,
      {
        landscapeGfx: [
          { index: 10, logicType: 11, editName: 'bush 01 fruits' },
          { index: 11, logicType: 11, editName: 'bush 02 fruits' },
          { index: 12, logicType: 11, editName: 'bush snow 01 fruits' },
          { index: 13, logicType: 10, editName: 'bush 01 flower' },
        ],
      },
      manifests,
    );
    if (typeof binding !== 'object') throw new Error('Missing own bush binding');
    for (const [index, species] of [
      [10, '01'],
      [11, '02'],
    ] as const) {
      expect(binding.byGfxIndex?.[index]).toEqual(
        ['empty', 'flower', 'fruits'].map((stage) => ({
          layer: `custom-prop-bush-${species}-${stage}`,
          bob: 0,
        })),
      );
    }
    expect(binding.byGfxIndex?.[7]).toEqual([{ layer: 'fallback', bob: 123 }]);
    expect(binding.byGfxIndex?.[12]).toBeUndefined();
    expect(binding.byGfxIndex?.[13]).toBeUndefined();
    expect(binding.default).toBe(99);
    expect(customBushBinding(fallback, null, manifests)).toBe(fallback);
    expect(customBushBinding(undefined, null, manifests)).toBeUndefined();
  });

  it('keeps incomplete seasonal families on their existing fallback', () => {
    const ir = { landscapeGfx: [{ index: 10, logicType: 11, editName: 'bush 01 fruits' }] };
    expect(
      customBushBinding(
        99,
        ir,
        manifests.filter((m) => m.id !== 'bush-01-flower'),
      ),
    ).toBe(99);
  });
});
