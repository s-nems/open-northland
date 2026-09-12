import { describe, expect, it } from 'vitest';
import { recipeSchema } from '../src/recipe.js';

const atlas = {
  path: 'characters/test/atlas.png',
  content: {
    operation: 'character',
    source: 'recipe.json',
    id: 'test',
    name: 'Test',
    shadow: 'shadows/shadow.json',
  },
};
const manifest = {
  path: 'characters/test/runtime.json',
  content: { operation: 'json', value: {} },
};
const recipe = {
  version: 1,
  id: 'characters/test',
  kind: 'character',
  sourceBasis: 'Synthetic fixture',
};

describe('generated character outputs', () => {
  it('rejects a character export without paired shadows', () => {
    const { shadow: _shadow, ...content } = atlas.content;
    expect(() => recipeSchema.parse({ ...recipe, outputs: [{ ...atlas, content }, manifest] })).toThrow();
  });
  it('requires the atlas location used by the runtime loader', () => {
    expect(() => recipeSchema.parse({ ...recipe, outputs: [atlas, manifest] })).not.toThrow();
    expect(() =>
      recipeSchema.parse({ ...recipe, outputs: [{ ...atlas, path: 'characters/test/other.png' }, manifest] }),
    ).toThrow('Character output');
  });

  it('rejects missing or authored manifests that the packer would silently overwrite', () => {
    for (const outputs of [
      [atlas],
      [atlas, { ...manifest, content: { operation: 'copy', source: 'runtime.json' } }],
      [atlas, { ...manifest, content: { operation: 'json', value: { scale: 0.75 } } }],
      [atlas, { ...manifest, content: { ...manifest.content, framesFrom: atlas.path } }],
    ])
      expect(() => recipeSchema.parse({ ...recipe, outputs })).toThrow('empty JSON runtime manifest');
  });
});
