import { type ElevationField, FLAG_WAVE_TICKS_PER_FRAME, type SpriteLayer } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../../src/content/ir/rows.js';
import { type PlaceholderGfx, placeCustomMapObjects } from '../../src/custom/content/objects.js';
import { type CustomPropManifest, customPropAtlas } from '../../src/custom/content/prop-manifest.js';
import type { LoadedCustomProp } from '../../src/custom/content/props.js';

/** The custom assets placement binding: a custom prop's frame per placement, and the paint order the
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
  kind: CustomPropManifest['kind'],
  anchorY = GRASS_ANCHOR_Y,
): LoadedCustomProp {
  const manifest: CustomPropManifest = {
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
    atlas: customPropAtlas(manifest),
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
 *  snow bush has no custom prop. */
const IR: ContentIr = {
  landscapeGfx: [
    { index: 1, logicType: 1, editName: 'grass 01' },
    { index: 2, logicType: 9, editName: 'bush 01 empty', walkBlockAreas: [] },
    { index: 3, logicType: 4, editName: 'pine 01', walkBlockAreas: [[1, 0, 0, 1]] },
    { index: 4, logicType: 9, editName: 'bush snow 01 empty', walkBlockAreas: [] },
  ],
};

describe('placeCustomMapObjects', () => {
  it('draws only ground cover on a record without a walk area as flat decor', () => {
    const { sprites } = placeCustomMapObjects(
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

  it('keeps a placement without a custom prop as a tall placeholder, with or without a record', () => {
    const { sprites, byPlacement } = placeCustomMapObjects(
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

  it('plays a placed delivery flag as one wave loop at the shared cadence instead of level stills', () => {
    const flag = prop('work-flag', ['player01 work extern 01'], 'flag');
    const frames = [0, 1, 2].map((i) => ({
      x: i * 40,
      y: 0,
      width: 40,
      height: 50,
      anchor: { x: 20, y: 40 },
    }));
    const manifest: CustomPropManifest = { ...flag.manifest, width: 120, frames };
    const loaded = { manifest, layer: { ...flag.layer, atlas: customPropAtlas(manifest) } };
    const { sprites } = placeCustomMapObjects(
      { types: ['player01 work extern 01'], placements: [0, 0, 0], levels: [2] },
      { landscapeGfx: [{ index: 5, logicType: 1, editName: 'player01 work extern 01' }] },
      FLAT,
      new Map([['player01 work extern 01', loaded]]),
      PLACEHOLDER,
    );
    const atlas = [...loaded.layer.atlas.frames.values()];
    expect(sprites[0]?.frames).toEqual(atlas.flatMap((f) => Array(FLAG_WAVE_TICKS_PER_FRAME).fill(f)));
  });
});
