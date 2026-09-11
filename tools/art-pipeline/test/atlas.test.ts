import { describe, expect, it } from 'vitest';
import { atlasOutputs } from '../src/atlas.js';
import { atlasRecipe } from '../src/atlas-recipe.js';
import { recipeSchema } from '../src/recipe.js';

describe('authored atlas recipes', () => {
  it('preserves source-pixel calibration without changing world scale', () => {
    const atlas = atlasRecipe.parse({
      type: 'vegetation',
      source: 'master.png',
      scale: 0.5,
      fit: 'frame-contain',
      sampling: 'lanczos3',
      props: [
        {
          id: 'fern',
          editNames: ['fern slot'],
          cell: [0, 0, 400, 400],
          size: [120, 84],
          anchor: { x: 54, y: 68 },
        },
      ],
    });
    const files = atlasOutputs(atlas, 'Synthetic calibration');
    const manifest = files.find((f) => f.path.endsWith('/runtime.json'))?.content;
    expect(manifest?.operation).toBe('json');
    if (manifest?.operation !== 'json') throw new Error('Missing generated manifest');
    expect(manifest.value).toMatchObject({
      id: 'fern',
      width: 120,
      height: 84,
      scale: 0.5,
      anchor: { x: 54, y: 68 },
      editNames: ['fern slot'],
    });
    expect(files[0]?.content).toMatchObject({ operation: 'raster', sampling: 'lanczos3' });
  });
  it('rejects duplicate generated IDs together with explicit output collisions', () => {
    const atlas = atlasRecipe.parse({
      type: 'vegetation',
      source: 'master.png',
      scale: 0.5,
      fit: 'frame',
      props: [
        {
          id: 'fern',
          editNames: ['fern slot'],
          cell: [0, 0, 400, 400],
          size: [120, 84],
          anchor: { x: 54, y: 68 },
        },
      ],
    });
    const outputs = atlasOutputs(atlas, 'Synthetic calibration');
    expect(() =>
      recipeSchema.parse({
        version: 1,
        id: 'terrain/ferns',
        kind: 'props',
        sourceBasis: 'Synthetic calibration',
        outputs: [...outputs, ...outputs],
      }),
    ).toThrow('Duplicate output');
  });
  it('rejects missing resource depletion cells before image processing', () => {
    const atlas = atlasRecipe.parse({
      type: 'rocks',
      sources: { dark: 'dark.png', light: 'light.png' },
      scale: 0.5,
      cells: [[0, 0, 100, 100]],
      stride: 192,
      height: 128,
      padding: 4,
      minimumFill: 0.4,
      restCells: [8],
      root: { x: 0.5, y: 0.58 },
      props: [
        {
          id: 'rock',
          editNames: ['rock slot'],
          size: [80, 40],
          states: 3,
          kind: 'resource',
          palette: 'dark',
          cell: 0,
        },
      ],
    });
    expect(() => atlasOutputs(atlas, 'Synthetic calibration')).toThrow('Missing rock cell');
  });
});
