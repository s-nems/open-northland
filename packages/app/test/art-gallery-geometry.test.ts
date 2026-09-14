import type { OwnBuildingManifest } from '@open-northland/art-contracts';
import { BuildingType } from '@open-northland/data';
import {
  CONSTRUCTION_SIGN_DX,
  SIGN_BASE_BELOW,
  SIGN_HALF_WIDTH,
  TILE_HALF_H,
  TILE_HALF_W,
} from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import type { ContentIr } from '../src/content/ir/rows.js';
import {
  buildingGeometryIndex,
  galleryBuildingTribes,
  geometryBounds,
} from '../src/entries/art-gallery/building-geometry.js';

const manifest: OwnBuildingManifest = {
  tribeId: 1,
  typeId: 2,
  layer: 'own-house-1',
  sprite: 'B-sprite.png',
  width: 64,
  height: 64,
  scale: 1,
  entrancePixel: { x: 32, y: 60 },
  doorNode: { x: -1, y: 3 },
  sourceBasis: 'test',
};
const VIKING = [1] as const;

/** The sim's row for the home: its door sits one node left of the manifest's. */
const buildings = [
  BuildingType.parse({
    typeId: 2,
    id: 'home_level_00',
    kind: 'home',
    footprint: {
      blocked: [{ dx: 0, dy: 0 }],
      familyBody: [{ dx: 0, dy: 0 }],
      reserved: [
        { dx: -1, dy: 0 },
        { dx: 0, dy: 0 },
        { dx: 1, dy: 0 },
      ],
      door: { dx: -2, dy: 3 },
    },
  }),
];
const ir: ContentIr = { buildingFlagPoints: [{ tribeId: 1, typeId: 2, level: 0, x: 1, y: 67 }] };

describe('gallery building geometry', () => {
  it('resolves the sim door, cells, post and a family banner from content', () => {
    const geometry = buildingGeometryIndex(buildings, ir, VIKING)(manifest);
    expect(geometry).toMatchObject({
      label: 'home_level_00',
      door: { dx: -2, dy: 3 },
      post: { x: 1, y: 67 },
      signRows: [{ role: 'family' }],
      fromContent: true,
    });
    expect(geometry.blocked).toHaveLength(1);
    expect(geometry.reserved).toHaveLength(3);
  });

  it('keeps the manifest door and the derived post without content', () => {
    const geometry = buildingGeometryIndex([], null, VIKING)(manifest);
    expect(geometry).toMatchObject({
      label: '#2',
      door: { dx: -1, dy: 3 },
      blocked: [],
      reserved: [],
      fromContent: false,
    });
    // The map's fallback: one node right of the door, on the lattice.
    expect(geometry.post).toEqual({ x: 0, y: (3 * TILE_HALF_H) / 2 });
    expect(geometry.signRows.map((row) => row.role)).toEqual(['craftsman', 'craftsman', 'carrier']);
  });

  it('bounds every cell diamond plus the sign chain and construction stand', () => {
    // Cells reach one node either side of the anchor and the door two nodes left, three rows down; the
    // post at (1, 67) reaches the stand's left edge and the banner's top.
    expect(geometryBounds(buildingGeometryIndex(buildings, ir, VIKING)(manifest))).toEqual({
      minX: Math.min(-2 * TILE_HALF_W - TILE_HALF_W / 2, 1 + CONSTRUCTION_SIGN_DX - SIGN_HALF_WIDTH),
      maxX: Math.max(TILE_HALF_W + TILE_HALF_W / 2, 1 + SIGN_HALF_WIDTH),
      minY: -TILE_HALF_H / 4,
      maxY: Math.max((3 * TILE_HALF_H) / 2 + TILE_HALF_H / 4, 67 + SIGN_BASE_BELOW),
    });
  });

  it('lists the base tribe first and every other skinned tribe once, in order', () => {
    expect(galleryBuildingTribes([{ tribeId: 3 }, { tribeId: 1 }, { tribeId: 3 }, { tribeId: 2 }])).toEqual([
      1, 2, 3,
    ]);
    expect(galleryBuildingTribes([])).toEqual([1]);
  });
});
