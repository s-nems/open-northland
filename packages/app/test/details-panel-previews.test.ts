import type { SpriteAtlas, SpriteLayer, SpriteSheet, TextureSource } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { buildingPreviews } from '../src/hud/details-panel/assets.js';

/**
 * The panel's building portrait, cut from the sheet's own building pages so each civilization sees the
 * body the map draws. A type no civilization skins has no portrait at all: the general window shows its
 * neutral plate instead, which a viking longhouse standing in for a wonder would quietly replace.
 */

const source = {} as TextureSource;
const VIKING = 1;
const SARACEN = 4;
const MILL = 13;
const WONDER = 47;
const VIKING_BOB = 70;
const SARACEN_BOB = 12;

const frame = (x: number) => ({ x, y: 0, width: 10, height: 12, offsetX: 0, offsetY: 0 });
const atlas: SpriteAtlas = {
  width: 100,
  height: 12,
  frames: new Map([
    [VIKING_BOB, frame(0)],
    [SARACEN_BOB, frame(20)],
  ]),
};
const houses: SpriteLayer = { source, atlas };

const sheet: SpriteSheet = {
  source,
  atlas: { width: 0, height: 0, frames: new Map() },
  bindings: {
    settler: 1,
    resource: 1,
    building: {
      byType: { [MILL]: VIKING_BOB },
      default: VIKING_BOB,
      byTribe: {
        [VIKING]: { byType: { [MILL]: VIKING_BOB } },
        [SARACEN]: { byType: { [MILL]: { layer: 'houses', bob: SARACEN_BOB } } },
      },
    },
  },
  kindLayers: { building: houses },
  families: { houses },
};

describe('buildingPreviews', () => {
  it('cuts each civilization its own portrait for the shared type', () => {
    const previews = buildingPreviews(sheet);
    expect(previews.get(MILL, VIKING)?.texture.frame.x).toBe(0);
    expect(previews.get(MILL, SARACEN)?.texture.frame.x).toBe(20);
  });

  it('falls back to the base tribe for a type the drawing civilization does not skin', () => {
    // Every tribe shares the type space but skins only part of it, so the base body beats no portrait.
    expect(buildingPreviews(sheet).get(MILL, 7)?.texture.frame.x).toBe(0);
  });

  it('has no portrait for a type no civilization skins', () => {
    // The wonders and the defence wall carry no `buildingBobs` row for a loaded tribe; the binding's
    // `default` would hand back the viking home, which the general window must not show as this building.
    expect(buildingPreviews(sheet).get(WONDER, VIKING)).toBeUndefined();
    expect(buildingPreviews(sheet).get(WONDER, undefined)).toBeUndefined();
  });

  it('has no portrait without a sheet, so a bare checkout keeps the plate', () => {
    expect(buildingPreviews(undefined).get(MILL, VIKING)).toBeUndefined();
  });

  it('mints one texture per drawn bob, so a rebuild reuses rather than re-wrapping the source', () => {
    const previews = buildingPreviews(sheet);
    expect(previews.get(MILL, VIKING)).toBe(previews.get(MILL, VIKING));
  });
});
