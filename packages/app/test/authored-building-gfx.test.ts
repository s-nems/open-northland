import { type DrawItem, resolveBuildingDraw, type SpriteSheet } from '@open-northland/render';
import { positionOfNode, type WorldSnapshot } from '@open-northland/sim';
import { TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { authoredBuildingSheet } from '../src/content/building-gfx/authored.js';
import { resolveAuthoredPlacements } from '../src/game/world/authored-placements.js';

const source = new TextureSource({ width: 1, height: 1 });
const atlas = {
  width: 1,
  height: 1,
  frames: new Map(
    [10, 20, 30].map((id) => [id, { x: 0, y: 0, width: 1, height: 1, offsetX: 0, offsetY: 0 }]),
  ),
};
const sheet: SpriteSheet = {
  source,
  atlas,
  kindLayers: { building: { source, atlas } },
  families: { 'test_houses.blue': { source, atlas }, 'test_houses.red': { source, atlas } },
  bindings: { settler: 0, resource: 0, building: { default: 10, byType: { 1: 10, 2: 30 } } },
};
const rows = {
  buildingFlagPoints: [
    { editName: 'base', level: 0, typeId: 1, tribeId: 1, x: 10, y: 11 },
    { editName: 'longhouse', level: 0, typeId: 1, tribeId: 1, x: 20, y: 21 },
  ],
  buildingBobs: [
    {
      editName: 'base',
      level: 0,
      typeId: 1,
      tribeId: 1,
      bmd: 'test_houses.bmd',
      paletteName: 'blue',
      bobId: 10,
    },
    {
      editName: 'longhouse',
      level: 0,
      typeId: 1,
      tribeId: 1,
      bmd: 'test_houses.bmd',
      paletteName: 'blue',
      bobId: 20,
    },
    {
      editName: 'longhouse',
      level: 0,
      typeId: 1,
      tribeId: 1,
      bmd: 'test_houses.bmd',
      paletteName: 'red',
      bobId: 20,
    },
    {
      editName: 'wall vertical',
      level: 0,
      typeId: 2,
      tribeId: 1,
      bmd: 'test_houses.bmd',
      paletteName: 'blue',
      bobId: 30,
    },
  ],
};
const { placements } = resolveAuthoredPlacements(
  {
    buildings: [
      { name: 'base', level: 0, hx: 2, hy: 3, player: 0 },
      { name: 'longhouse', level: 0, hx: 6, hy: 3, player: 0 },
      { name: 'wall vertical', level: 0, hx: 8, hy: 7, player: 0 },
    ],
    humans: [],
    animals: [],
  },
  rows,
  { width: 20, height: 20 },
);
const snapshot: WorldSnapshot = {
  tick: 10,
  events: [],
  entities: [
    { id: 2, components: { Position: positionOfNode(2, 3), Building: { buildingType: 1, tribe: 1 } } },
    { id: 3, components: { Position: positionOfNode(6, 3), Building: { buildingType: 1, tribe: 1 } } },
    { id: 4, components: { Position: positionOfNode(8, 7), Building: { buildingType: 2, tribe: 1 } } },
  ],
};
const item: DrawItem = { kind: 'building', ref: 3, tribe: 1, typeId: 1, x: 0, y: 0, depth: 0 };

describe('authored building graphics', () => {
  it('keeps both authored bodies of one type, palette cycling, and another building type', () => {
    const result = authoredBuildingSheet(sheet, placements, snapshot);
    expect(result.skipped).toBe(0);
    const binding = result.sheet.bindings.building;
    expect(typeof binding === 'object' && binding.byEntity?.get(3)?.flagPoint).toEqual({ x: 20, y: 21 });
    expect(resolveBuildingDraw(binding, { ...item, ref: 2 })).toEqual({ layer: 'test_houses.blue', bob: 10 });
    expect(resolveBuildingDraw(binding, item)).toEqual({ layer: 'test_houses.red', bob: 20 });
    expect(resolveBuildingDraw(binding, { ...item, ref: 4, typeId: 2 })).toEqual({
      layer: 'test_houses.blue',
      bob: 30,
    });
    // A newly built house, a changed tribe and an upgraded type keep their canonical binding.
    expect(resolveBuildingDraw(binding, { ...item, ref: 9 })).toEqual({ bob: 10 });
    expect(resolveBuildingDraw(binding, { ...item, tribe: 2 })).toEqual({ bob: 10 });
    expect(resolveBuildingDraw(binding, { ...item, typeId: 2 })).toEqual({ bob: 30 });
  });

  it('places holy fire at the bound body’s anchors only when the effect is loaded', () => {
    const ir = {
      buildingHolyFirePoints: [
        { tribeId: 1, typeId: 1, level: 0, editName: 'base', x: 5, y: 6 },
        { tribeId: 1, typeId: 1, level: 0, editName: 'longhouse', x: 15, y: 16 },
      ],
    };
    const loaded = { ...sheet, holyFire: () => undefined };
    const result = authoredBuildingSheet(loaded, placements, snapshot, ir);
    expect(result.sheet.holyFire?.(1, 1, 0, 3)?.points).toEqual([{ x: 15, y: 16 }]);
    expect(result.sheet.holyFire?.(1, 1, 0, 2)?.points).toEqual([{ x: 5, y: 6 }]);
    expect(authoredBuildingSheet(sheet, placements, snapshot, ir).sheet.holyFire).toBeUndefined();
  });

  it('counts unavailable families and frames and keeps the canonical body', () => {
    const result = authoredBuildingSheet({ ...sheet, families: {} }, placements, snapshot);
    expect(result.skipped).toBe(3);
    expect(resolveBuildingDraw(result.sheet.bindings.building, item)).toEqual({ bob: 10 });
    const missing = authoredBuildingSheet(
      { ...sheet, families: { 'test_houses.red': { source, atlas: { ...atlas, frames: new Map() } } } },
      placements,
      snapshot,
    );
    expect(missing.skipped).toBe(3);
  });

  it('leaves demo and synthetic sheets intact and does not bind a remapped civilization', () => {
    expect(authoredBuildingSheet(sheet, [], snapshot).sheet).toBe(sheet);
    const synthetic = { ...sheet, bindings: { ...sheet.bindings, building: 7 } };
    expect(authoredBuildingSheet(synthetic, placements, snapshot).sheet).toBe(synthetic);
    const changed = {
      ...snapshot,
      entities: [
        { id: 3, components: { Position: positionOfNode(6, 3), Building: { buildingType: 1, tribe: 2 } } },
      ],
    };
    expect(authoredBuildingSheet(sheet, placements, changed).sheet).toBe(sheet);
  });

  it('rebinds surviving houses from a restored snapshot without transferring their graphics into state', () => {
    const restored = structuredClone(snapshot);
    const before = JSON.stringify(restored);
    const result = authoredBuildingSheet(sheet, placements, restored);
    expect(resolveBuildingDraw(result.sheet.bindings.building, item)).toEqual({
      layer: 'test_houses.red',
      bob: 20,
    });
    expect(JSON.stringify(restored)).toBe(before);
  });
});
