import type { ElevationField, SpriteLayer } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { type PlaceholderGfx, placeOwnMapObjects } from '../src/content/own-assets/objects.js';
import { type OwnPropManifest, ownPropAtlas } from '../src/content/own-assets/prop-manifest.js';
import type { LoadedOwnProp } from '../src/content/own-assets/props.js';

/** The own-assets placement binding: an own prop's frame per placement, and the paint order the
 *  placement's original record decides. Texture sources are opaque handles here. */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const PLACEHOLDER: PlaceholderGfx = {
  source: 'placeholder' as unknown as PlaceholderGfx['source'],
  frames: [{ x: 0, y: 0, width: 10, height: 10, offsetX: -5, offsetY: -5 }],
};

function prop(id: string, editNames: [string, ...string[]], kind: OwnPropManifest['kind']): LoadedOwnProp {
  const manifest: OwnPropManifest = {
    id,
    kind,
    image: `${id}.png`,
    width: 40,
    height: 60,
    anchor: { x: 20, y: 50 },
    scale: 0.5,
    editNames,
    sourceBasis: 'test fixture',
  };
  const layer: SpriteLayer = {
    source: id as unknown as SpriteLayer['source'],
    atlas: ownPropAtlas(manifest),
  };
  return { manifest, layer };
}

const PROPS = new Map(
  [
    prop('grass-a', ['grass 01'], 'decor'),
    prop('bush-a', ['bush 01 empty'], 'decor'),
    prop('pine-a', ['pine 01'], 'resource'),
  ].flatMap((p) => p.manifest.editNames.map((name) => [name, p] as const)),
);

/** A tree stands on a walk area; grass and an empty bush stand on none, like the original records. */
const IR: ContentIr = {
  landscapeGfx: [
    { index: 1, logicType: 1, editName: 'grass 01' },
    { index: 2, logicType: 9, editName: 'bush 01 empty', walkBlockAreas: [] },
    { index: 3, logicType: 4, editName: 'pine 01', walkBlockAreas: [[1, 0, 0, 1]] },
  ],
};

describe('placeOwnMapObjects', () => {
  it('draws a placement as flat decor iff its original record carries no walk area', () => {
    const { sprites } = placeOwnMapObjects(
      { types: ['grass 01', 'bush 01 empty', 'pine 01'], placements: [0, 0, 0, 2, 0, 1, 4, 0, 2] },
      IR,
      FLAT,
      PROPS,
      PLACEHOLDER,
    );
    expect(sprites.map((s) => [s.source, s.decor])).toEqual([
      ['grass-a', true],
      ['bush-a', true],
      ['pine-a', false],
    ]);
  });

  it('keeps a placement without a record or prop as a tall placeholder', () => {
    const { sprites, byPlacement } = placeOwnMapObjects(
      { types: ['grass 01', 'unknown thing'], placements: [0, 0, 1, 2, 0, 0] },
      IR,
      FLAT,
      PROPS,
      PLACEHOLDER,
    );
    expect(sprites[0]).toMatchObject({
      source: 'placeholder',
      frames: PLACEHOLDER.frames,
      decor: false,
      scale: 1,
    });
    expect(sprites[1]).toMatchObject({ source: 'grass-a', decor: true, scale: 0.5 });
    expect([...byPlacement.keys()]).toEqual([0, 1]);
  });
});
