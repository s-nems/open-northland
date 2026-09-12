import type { ElevationField, SpriteLayer } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import { type PlaceholderGfx, placeOwnMapObjects } from '../src/content/own-assets/objects.js';
import { type OwnPropManifest, ownPropAtlas } from '../src/content/own-assets/prop-manifest.js';
import type { LoadedOwnProp } from '../src/content/own-assets/props.js';

/** The own-assets placement binding: an own prop's frame per placement, and the paint order the
 *  placement's original record and painted height decide. Texture sources are opaque handles here. */

const FLAT: ElevationField = { maxLift: 0, liftAt: () => 0, liftAtNode: () => 0 };
const PLACEHOLDER: PlaceholderGfx = {
  source: 'placeholder' as unknown as PlaceholderGfx['source'],
  frames: [{ x: 0, y: 0, width: 10, height: 10, offsetX: -5, offsetY: -5 }],
};

/** Painted heights above the feet at the fixture's 0.5 scale: 20 px of grass, 55 px of bush. */
const GRASS_ANCHOR_Y = 40;
const BUSH_ANCHOR_Y = 110;

function prop(
  id: string,
  editNames: [string, ...string[]],
  kind: OwnPropManifest['kind'],
  anchorY = GRASS_ANCHOR_Y,
): LoadedOwnProp {
  const manifest: OwnPropManifest = {
    id,
    kind,
    image: `${id}.png`,
    width: 40,
    height: anchorY + 10,
    anchor: { x: 20, y: anchorY },
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
    prop('bush-a', ['bush 01 empty'], 'decor', BUSH_ANCHOR_Y),
    prop('pine-a', ['pine 01'], 'resource'),
  ].flatMap((p) => p.manifest.editNames.map((name) => [name, p] as const)),
);

/** A tree stands on a walk area; grass and the bushes stand on none, like the original records. The
 *  snow bush has no own prop. */
const IR: ContentIr = {
  landscapeGfx: [
    { index: 1, logicType: 1, editName: 'grass 01' },
    { index: 2, logicType: 9, editName: 'bush 01 empty', walkBlockAreas: [] },
    { index: 3, logicType: 4, editName: 'pine 01', walkBlockAreas: [[1, 0, 0, 1]] },
    { index: 4, logicType: 9, editName: 'bush snow 01 empty', walkBlockAreas: [] },
  ],
};

describe('placeOwnMapObjects', () => {
  it('draws only ground cover on a record without a walk area as flat decor', () => {
    const { sprites } = placeOwnMapObjects(
      { types: ['grass 01', 'bush 01 empty', 'pine 01'], placements: [0, 0, 0, 2, 0, 1, 4, 0, 2] },
      IR,
      FLAT,
      PROPS,
      PLACEHOLDER,
    );
    expect(sprites.map((s) => [s.source, s.decor])).toEqual([
      ['grass-a', true],
      ['bush-a', false],
      ['pine-a', false],
    ]);
  });

  it('keeps a placement without an own prop as a tall placeholder, with or without a record', () => {
    const { sprites, byPlacement } = placeOwnMapObjects(
      {
        types: ['grass 01', 'unknown thing', 'bush snow 01 empty'],
        placements: [0, 0, 1, 2, 0, 0, 4, 0, 2],
      },
      IR,
      FLAT,
      PROPS,
      PLACEHOLDER,
    );
    const placeholder = { source: 'placeholder', frames: PLACEHOLDER.frames, decor: false, scale: 1 };
    expect(sprites[0]).toMatchObject(placeholder);
    expect(sprites[1]).toMatchObject({ source: 'grass-a', decor: true, scale: 0.5 });
    expect(sprites[2]).toMatchObject(placeholder);
    expect([...byPlacement.keys()]).toEqual([0, 1, 2]);
  });
});
