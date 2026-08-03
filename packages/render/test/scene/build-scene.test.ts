import { describe, expect, it } from 'vitest';
import { buildScene, terrainMapToScene, tileToScreen } from '../../src/index.js';
import { entity, FLAT_3x2, snapshotOf } from '../support/fixtures.js';

describe('buildScene - projection, depth order & classification', () => {
  it('emits one tile per cell, in row-major order, carrying its landscape typeId', () => {
    const scene = buildScene(snapshotOf([]), FLAT_3x2);
    const tiles = scene.filter((d) => d.kind === 'tile');
    expect(tiles).toHaveLength(6); // 3*2 cells
    expect(tiles.map((t) => t.ref)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(tiles.map((t) => t.typeId)).toEqual([1, 1, 2, 2, 1, 1]);
  });

  it('projects a tile to the iso position its (col,row) maps to', () => {
    const scene = buildScene(snapshotOf([]), FLAT_3x2);
    // cell 4 = (col 1, row 1) in a width-3 grid.
    const tile4 = scene.find((d) => d.kind === 'tile' && d.ref === 4);
    expect(tile4).toBeDefined();
    const expected = tileToScreen(1, 1);
    expect(tile4?.x).toBe(expected.x);
    expect(tile4?.y).toBe(expected.y);
  });

  it('draws every terrain tile behind every sprite', () => {
    const scene = buildScene(snapshotOf([entity(1, 0, 0, { Settler: { tribe: 0 } })]), FLAT_3x2);
    const lastTileIdx = scene.map((d) => d.kind).lastIndexOf('tile');
    const firstSpriteIdx = scene.findIndex((d) => d.kind !== 'tile');
    expect(lastTileIdx).toBeLessThan(firstSpriteIdx);
    const maxTileDepth = Math.max(...scene.filter((d) => d.kind === 'tile').map((d) => d.depth));
    const minSpriteDepth = Math.min(...scene.filter((d) => d.kind !== 'tile').map((d) => d.depth));
    expect(maxTileDepth).toBeLessThan(minSpriteDepth);
  });

  it('depth-sorts sprites by feet anchor: lower (greater y) draws later/in front', () => {
    const scene = buildScene(
      snapshotOf([entity(1, 1, 0, { Settler: { tribe: 0 } }), entity(2, 1, 2, { Settler: { tribe: 0 } })]),
      FLAT_3x2,
    );
    const sprites = scene.filter((d) => d.kind === 'settler');
    expect(sprites.map((s) => s.ref)).toEqual([1, 2]);
  });

  it('paints a settler IN FRONT of the resource node it stands on (same cell), overriding id order', () => {
    // A harvester stands on the node it works and holds the lower id here, so a plain id tiebreak would
    // draw it behind and the worker would vanish into the tree.
    const scene = buildScene(
      snapshotOf([
        entity(1, 1, 1, { Settler: { tribe: 0 } }),
        entity(2, 1, 1, { Resource: { goodType: 1 } }),
      ]),
      FLAT_3x2,
    );
    const order = scene.filter((d) => d.kind === 'settler' || d.kind === 'resource').map((d) => d.kind);
    expect(order).toEqual(['resource', 'settler']);
  });

  it('paints a bare stockpile pile IN FRONT of the ground drops on its cell, overriding id order', () => {
    // The bare pile holds the lower id, so id order would draw it behind the drop it shares a cell with.
    const scene = buildScene(
      snapshotOf([
        entity(3, 1, 1, { Stockpile: { amounts: [[1, 2]] } }),
        entity(4, 1, 1, { Stockpile: { amounts: [[1, 1]] }, GroundDrop: {} }),
      ]),
      FLAT_3x2,
    );
    const order = scene.filter((d) => d.kind === 'grounddrop' || d.kind === 'stockpile').map((d) => d.kind);
    expect(order).toEqual(['grounddrop', 'stockpile']);
  });

  it('paints a delivery FLAG in front of a co-located goods heap of its own kind (FLAG_PAINT_STEP)', () => {
    // The flag and the heap piling up on it both classify as `stockpile`, so the kind bias ties and the
    // id tiebreak would bury the earlier flag under the later heap.
    const scene = buildScene(
      snapshotOf([
        entity(3, 1, 1, { DeliveryFlag: {} }),
        entity(5, 1, 1, { Stockpile: { amounts: [[1, 3]] } }),
      ]),
      FLAT_3x2,
    );
    const stock = scene.filter((d) => d.kind === 'stockpile');
    expect(stock.map((d) => d.ref)).toEqual([5, 3]);
    const flag = stock.find((d) => d.ref === 3);
    const heap = stock.find((d) => d.ref === 5);
    expect(flag?.isFlag).toBe(true);
    expect(flag?.goodType).toBeUndefined(); // a flag holds no goods
    expect((flag?.depth ?? 0) > (heap?.depth ?? 0)).toBe(true);
  });

  it('breaks an equal-feet tie by x then by entity id (a total, stable order)', () => {
    const scene = buildScene(
      snapshotOf([
        entity(3, 2, 1, { Settler: { tribe: 0 } }), // same y, greatest x
        entity(1, 0, 1, { Settler: { tribe: 0 } }), // same y, least x
        entity(2, 0, 1, { Settler: { tribe: 0 } }), // same tile as id 1
      ]),
      FLAT_3x2,
    );
    expect(scene.filter((d) => d.kind === 'settler').map((s) => s.ref)).toEqual([1, 2, 3]);
  });

  it('classifies buildings and resources, and skips a marker-less positioned entity', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Building: { buildingType: 5 } }),
        entity(2, 1, 1, { Resource: { goodType: 1 } }),
        entity(3, 2, 0, { PathFollow: { waypoints: [], index: 0 } }), // no drawable marker
      ]),
      FLAT_3x2,
    );
    const kinds = scene.filter((d) => d.kind !== 'tile').map((d) => d.kind);
    expect(kinds.sort()).toEqual(['building', 'resource']);
  });

  it('stamps a building draw item with its buildingType (so a per-type binding picks its bob)', () => {
    const scene = buildScene(
      snapshotOf([
        entity(1, 0, 0, { Building: { buildingType: 6 } }),
        entity(2, 1, 1, { Resource: { goodType: 1 } }),
      ]),
      FLAT_3x2,
    );
    expect(scene.find((d) => d.kind === 'building')?.typeId).toBe(6);
    // Only tiles and buildings carry a typeId.
    expect(scene.find((d) => d.kind === 'resource')?.typeId).toBeUndefined();
  });

  it('consumes a loaded terrain map (the parseTerrainMap shape) via terrainMapToScene', () => {
    // A decoded map carries varied landscape typeIds, and the GPU layer tints each tile by typeId.
    const loadedMap = { width: 2, height: 3, typeIds: [5, 1, 2, 5, 16, 1] };
    const terrain = terrainMapToScene(loadedMap);
    expect(terrain).toEqual({ width: 2, height: 3, typeIds: [5, 1, 2, 5, 16, 1] });

    const scene = buildScene(snapshotOf([]), terrain);
    const tiles = scene.filter((d) => d.kind === 'tile');
    expect(tiles).toHaveLength(6); // 2*3 cells
    expect(tiles.map((t) => t.typeId)).toEqual([5, 1, 2, 5, 16, 1]);
  });

  it('is pure: the same snapshot yields a byte-identical draw list', () => {
    const snap = snapshotOf([
      entity(1, 1, 0, { Settler: { tribe: 0 } }),
      entity(2, 0, 2, { Building: { buildingType: 1 } }),
    ]);
    const a = buildScene(snap, FLAT_3x2);
    const b = buildScene(snap, FLAT_3x2);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
