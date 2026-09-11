import type { z } from 'zod';
import type { AtlasRecipe } from './atlas-recipe.js';
import { output, type raster } from './recipe.js';

interface Sprite {
  readonly id: string;
  readonly editNames: string[];
  readonly raster: z.input<typeof raster>;
  readonly manifest: Record<string, unknown>;
  readonly frames: boolean;
}
function vegetation(atlas: Extract<AtlasRecipe, { type: 'vegetation' }>): Sprite[] {
  return atlas.props.map((entry) => {
    const [width, height] = entry.size;
    const availableHeight =
      atlas.fit === 'frame' || atlas.fit === 'frame-contain' ? height - 4 : entry.anchor.y - 2;
    return {
      id: entry.id,
      editNames: entry.editNames,
      frames: false,
      raster: {
        operation: 'raster',
        sampling: atlas.sampling,
        width,
        height,
        alpha: 'transparent',
        draws: [
          {
            source: atlas.source,
            crop: entry.cell,
            alphaBounds: true,
            box: [2, 2, width - 4, availableHeight],
            fit: atlas.fit === 'contain' || atlas.fit === 'frame-contain' ? 'contain' : 'stretch',
            align: atlas.fit === 'frame-contain' ? 'center' : atlas.fit === 'contain' ? 'bottom' : 'start',
          },
        ],
      },
      manifest: {
        kind: 'decor',
        anchor: entry.anchor,
        ...(entry.brightness === undefined ? {} : { brightness: entry.brightness }),
      },
    };
  });
}
function trees(atlas: Extract<AtlasRecipe, { type: 'trees' }>): Sprite[] {
  return atlas.props.map((entry) => ({
    id: entry.id,
    editNames: entry.editNames,
    frames: true,
    raster: {
      operation: 'raster',
      sampling: atlas.sampling,
      width: atlas.canvas[0],
      height: atlas.canvas[1],
      alpha: 'transparent',
      draws: entry.states.map(([width, height], i) => ({
        source: atlas.source,
        crop: entry.cell,
        alphaBounds: true,
        box: [i * atlas.stride + atlas.padding, atlas.padding, width, height],
        frameAnchor: entry.root,
      })),
    },
    manifest: { kind: 'resource', anchor: { x: 0, y: 0 }, sway: entry.sway },
  }));
}
function rocks(atlas: Extract<AtlasRecipe, { type: 'rocks' }>): Sprite[] {
  return atlas.props.map((entry) => ({
    id: entry.id,
    editNames: entry.editNames,
    frames: true,
    raster: {
      operation: 'raster',
      sampling: atlas.sampling,
      width: atlas.stride * entry.states,
      height: atlas.height,
      alpha: 'transparent',
      draws: Array.from({ length: entry.states }, (_, i) => {
        const fullness =
          entry.states === 1 ? 1 : atlas.minimumFill + ((1 - atlas.minimumFill) * i) / (entry.states - 1);
        const index =
          entry.states > 1 && i === 0 ? atlas.restCells[entry.cell % atlas.restCells.length] : entry.cell;
        const crop = index === undefined ? undefined : atlas.cells[index];
        if (!crop) throw new Error(`Missing rock cell for ${entry.id}`);
        return {
          source: atlas.sources[entry.palette],
          reference: atlas.sources.light,
          crop,
          alphaBounds: true,
          box: [
            i * atlas.stride + atlas.padding,
            atlas.padding,
            entry.size[0] * fullness,
            entry.size[1] * fullness,
          ],
          fit: 'contain',
          round: true,
          frameAnchor: atlas.root,
        };
      }),
    },
    manifest: { kind: entry.kind, anchor: { x: 0, y: 0 } },
  }));
}
export function atlasOutputs(atlas: AtlasRecipe, sourceBasis: string) {
  const sprites =
    atlas.type === 'vegetation' ? vegetation(atlas) : atlas.type === 'trees' ? trees(atlas) : rocks(atlas);
  return sprites.flatMap((sprite) => {
    const path = `props/${sprite.id}/${sprite.id}.png`;
    const manifest = {
      id: sprite.id,
      image: `${sprite.id}.png`,
      scale: atlas.scale,
      editNames: sprite.editNames,
      sourceBasis,
      width: sprite.raster.width,
      height: sprite.raster.height,
      ...sprite.manifest,
    };
    return [
      output.parse({ path, content: sprite.raster }),
      output.parse({
        path: `props/${sprite.id}/runtime.json`,
        content: { operation: 'json', value: manifest, ...(sprite.frames ? { framesFrom: path } : {}) },
      }),
    ];
  });
}
