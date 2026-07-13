import { describe, expect, it } from 'vitest';
import {
  HALF_CELLS_PER_CELL,
  lmltToTerrainMap,
  MAP_LAYER_CODEC_X8,
  type MapLayer,
  reduceHalfCellsToCell,
  VOID_TYPE_ID,
} from '../src/decoders/mapdat/index.js';

describe('reduceHalfCellsToCell', () => {
  it('returns the value of a uniform cell (all four half-cells equal)', () => {
    expect(reduceHalfCellsToCell(7, 7, 7, 7)).toBe(7);
    expect(reduceHalfCellsToCell(0, 0, 0, 0)).toBe(0);
  });

  it('returns the dominant (most-frequent) value', () => {
    expect(reduceHalfCellsToCell(5, 5, 5, 2)).toBe(5); // 3 vs 1
    expect(reduceHalfCellsToCell(2, 5, 5, 5)).toBe(5); // dominant regardless of position
    expect(reduceHalfCellsToCell(9, 3, 3, 9)).toBe(3); // 2 vs 2 -> lower id wins (tie-break)
  });

  it('breaks ties by the lowest value, independent of half-cell order', () => {
    // Four distinct values — each count 1, so the tie-break selects the minimum every time.
    expect(reduceHalfCellsToCell(8, 1, 4, 2)).toBe(1);
    expect(reduceHalfCellsToCell(2, 4, 1, 8)).toBe(1);
    // Two pairs tied at count 2 -> the smaller of the two pair values.
    expect(reduceHalfCellsToCell(6, 6, 1, 1)).toBe(1);
    expect(reduceHalfCellsToCell(1, 6, 1, 6)).toBe(1);
  });
});

describe('lmltToTerrainMap', () => {
  /** Builds a MapLayer from a flat half-cell byte array (row-major 2W × 2H). */
  const layer = (halfCells: number[]): MapLayer => ({
    codec: MAP_LAYER_CODEC_X8,
    cells: Uint8Array.from(halfCells),
  });

  it('collapses each 2×2 half-cell block into one row-major typeId (raw value IS the typeId)', () => {
    // 2×1 grid = a 4×2 half-cell lane. Cell 0's block is columns 0-1 of both rows (uniform raw 3);
    // cell 1's block is columns 2-3 (dominant raw 5 with a stray 2 in the bottom row).
    const map = lmltToTerrainMap(
      layer([
        3,
        3,
        5,
        5, // half-cell row 0
        3,
        3,
        5,
        2, // half-cell row 1
      ]),
      { width: 2, height: 1 },
    );
    expect(map.width).toBe(2);
    expect(map.height).toBe(1);
    expect(map.typeIds).toEqual([3, 5]); // raw values pass through unshifted
    expect(map.typeIds.length).toBe(2 * 1);
  });

  it('gathers each cell block from BOTH lane rows, not four consecutive bytes', () => {
    // 2×1 grid whose lane rows disagree: reading four consecutive bytes would see [1,1,1,1] for
    // cell 0; the correct 2×2 block is columns 0-1 of each row = [1,1,9,9] -> tie -> lowest (1),
    // and cell 1's block [1,1,9,9] likewise. A wrong flat read would give cell 1 = [9,9,9,9] = 9.
    const map = lmltToTerrainMap(
      layer([
        1,
        1,
        1,
        1, // half-cell row 0
        9,
        9,
        9,
        9, // half-cell row 1
      ]),
      { width: 2, height: 1 },
    );
    expect(map.typeIds).toEqual([1, 1]);
  });

  it('maps the empty half-cell marker (raw 0 = no object) onto the void typeId', () => {
    // Raw values are the 1-based IR typeIds directly ([GfxLandscape] LogicType pins this); raw 0
    // means "no landscape object here" and reduces to `void` (typeId 1) so the sim's
    // buildTerrainGraph always resolves the grid against the IR table.
    const map = lmltToTerrainMap(layer([0, 0, 0, 0]), { width: 1, height: 1 });
    expect(map.typeIds).toEqual([VOID_TYPE_ID]);
  });

  it('produces a typeIds grid sized exactly width × height', () => {
    const cells = 3 * 2;
    const halfCells = new Array(cells * HALF_CELLS_PER_CELL).fill(0);
    const map = lmltToTerrainMap(layer(halfCells), { width: 3, height: 2 });
    expect(map.typeIds.length).toBe(cells);
    expect(map.typeIds).toEqual(new Array(cells).fill(VOID_TYPE_ID));
  });

  it('is deterministic — same layer + dims yield byte-identical typeIds', () => {
    // 3×1 grid = a 6×2 half-cell lane.
    const halfCells = [
      1,
      2,
      7,
      7,
      9,
      4, // half-cell row 0
      2,
      1,
      7,
      7,
      4,
      9, // half-cell row 1
    ];
    const a = lmltToTerrainMap(layer(halfCells), { width: 3, height: 1 });
    const b = lmltToTerrainMap(layer(halfCells), { width: 3, height: 1 });
    expect(a.typeIds).toEqual(b.typeIds);
    expect(a.typeIds).toEqual([1, 7, 4]); // 1<2 tie, uniform 7, 4<9 tie — raw values unshifted
  });

  it('throws when the layer length is not width × height × 4', () => {
    // 6 half-cell bytes can't be a 2×1 grid (needs 8).
    expect(() => lmltToTerrainMap(layer([1, 1, 1, 1, 2, 2]), { width: 2, height: 1 })).toThrow(
      /lmlt layer has 6 bytes, expected 8/,
    );
  });
});
