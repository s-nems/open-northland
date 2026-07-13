import { parseTerrainMap } from '@open-northland/data';
import { describe, expect, it, vi } from 'vitest';
import { encodeMapDat, encodeMapSize, packMapLayer, packX6elLayer } from '../src/decoders/mapdat/index.js';
import { mapDatToTerrain } from '../src/stages/maps/index.js';
import { buildMapDat } from './fixtures/mapdat.js';

describe('mapDatToTerrain', () => {
  it('decodes a synthetic map.dat into the per-cell TerrainMap (dominant half-cell per cell)', () => {
    // 2×1 grid = a 4×2 half-cell lane. Cell 0's 2×2 block is uniform raw 2; cell 1's block is
    // [5,2,5,2] -> tie at 2 -> the lowest raw value (2) wins. Raw values ARE the IR typeIds.
    const terrain = mapDatToTerrain(
      buildMapDat(2, 1, [
        2,
        2,
        5,
        2, // half-cell row 0
        2,
        2,
        5,
        2, // half-cell row 1
      ]),
    );
    expect(terrain).toEqual({ width: 2, height: 1, typeIds: [2, 2] });
  });

  it('reduces a non-uniform cell to its dominant half-cell typeId', () => {
    // 1×1 grid, block [5,5,5,2] -> raw 5 dominates (3 vs 1) and passes through unshifted.
    const terrain = mapDatToTerrain(buildMapDat(1, 1, [5, 5, 5, 2]));
    expect(terrain).toEqual({ width: 1, height: 1, typeIds: [5] });
  });

  it('throws on a map.dat with no lmlt landscape-type chunk', () => {
    const noLmlt = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 1, height: 1 }) },
    ]);
    expect(() => mapDatToTerrain(noLmlt)).toThrow(/no lmlt/);
  });

  it('throws on a non-container buffer', () => {
    expect(() => mapDatToTerrain(Uint8Array.from([1, 2, 3, 4]))).toThrow(/mapdat/);
  });

  /** Encodes a name-dictionary payload: [u32 count] then per entry [u8 len][bytes][0x00]. */
  const stringList = (names: string[]): Uint8Array => {
    const bytes: number[] = [names.length & 0xff, (names.length >>> 8) & 0xff, 0, 0];
    for (const n of names) {
      bytes.push(n.length);
      for (let i = 0; i < n.length; i++) bytes.push(n.charCodeAt(i) & 0xff);
      bytes.push(0);
    }
    return Uint8Array.from(bytes);
  };

  it('emits the ground layer from empa/empb + the eapd name dictionary, compacted to used names', () => {
    // 2×1 grid. The eapd dictionary has 4 names; the lanes only use ids 1 and 3, so the emitted
    // pattern list is compacted to those two (ascending), and the lanes remap onto it.
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 2, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0])) },
      { tag: 'empa', version: 1, payload: packX6elLayer(Uint16Array.from([1, 3])) },
      { tag: 'empb', version: 1, payload: packX6elLayer(Uint16Array.from([3, 3])) },
      {
        tag: 'eapd',
        version: 1,
        payload: stringList(['border', 'meadow 01', 'water 01', 'block meadow 00 01 00']),
      },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.ground).toEqual({
      patterns: ['meadow 01', 'block meadow 00 01 00'],
      a: [0, 1],
      b: [1, 1],
    });
  });

  it('emits the transitions layer from emt1..emt4 + the eatd dictionary VERBATIM (no compaction)', () => {
    // 2×1 grid: four per-cell u8 lanes (255 = none; v<255 → transition ⌊v/6⌋ + pair v%6). The
    // dictionary and the lane values pass through untouched — the ⌊v/6⌋ join is positional.
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 2, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0])) },
      { tag: 'emt1', version: 1, payload: packMapLayer(Uint8Array.from([0, 255])) },
      { tag: 'emt2', version: 1, payload: packMapLayer(Uint8Array.from([7, 255])) },
      { tag: 'emt3', version: 1, payload: packMapLayer(Uint8Array.from([255, 11])) },
      { tag: 'emt4', version: 1, payload: packMapLayer(Uint8Array.from([255, 255])) },
      { tag: 'eatd', version: 1, payload: stringList(['meadow 1', 'meadow 2']) },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.transitions).toEqual({
      types: ['meadow 1', 'meadow 2'],
      a1: [0, 255],
      b1: [7, 255],
      a2: [255, 11],
      b2: [255, 255],
    });
  });

  it('degrades an out-of-dictionary transition value to a grid without the layer (warn, keep the grid)', () => {
    // Value 12 → transition index 2, but the dictionary has 2 entries — a corrupt lane drops only
    // the optional transitions layer, never the nav grid.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 1, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 0, 0, 0])) },
      { tag: 'emt1', version: 1, payload: packMapLayer(Uint8Array.from([12])) },
      { tag: 'emt2', version: 1, payload: packMapLayer(Uint8Array.from([255])) },
      { tag: 'emt3', version: 1, payload: packMapLayer(Uint8Array.from([255])) },
      { tag: 'emt4', version: 1, payload: packMapLayer(Uint8Array.from([255])) },
      { tag: 'eatd', version: 1, payload: stringList(['meadow 1', 'meadow 2']) },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.typeIds).toEqual([1]); // the nav grid survives
    expect(terrain.transitions).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/transition lanes unreadable.*outside/));
    warn.mockRestore();
  });

  it('omits the transitions layer when any of the five chunks is missing (older/foreign saves)', () => {
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 1, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 0, 0, 0])) },
      { tag: 'emt1', version: 1, payload: packMapLayer(Uint8Array.from([255])) },
      { tag: 'eatd', version: 1, payload: stringList(['meadow 1']) },
    ]);
    expect(mapDatToTerrain(bytes).transitions).toBeUndefined();
  });

  it('emits a transitions layer the loader schema accepts, and the schema rejects corrupt lanes', () => {
    // Close the emit→load loop: what mapDatToTerrain writes must pass parseTerrainMap's refines,
    // and the refines must actually bite (wrong lane length; out-of-dictionary value) — the
    // pipeline's own throws run pre-emission, so only the schema guards a hand-edited/stale file.
    const good = {
      width: 2,
      height: 1,
      typeIds: [1, 1],
      transitions: {
        types: ['meadow 1', 'meadow 2'],
        a1: [0, 255],
        b1: [7, 255],
        a2: [255, 11],
        b2: [255, 255],
      },
    };
    expect(parseTerrainMap(good).transitions).toEqual(good.transitions);
    expect(() => parseTerrainMap({ ...good, transitions: { ...good.transitions, a1: [0] } })).toThrow(
      /transition lanes must be width\*height/,
    );
    expect(() => parseTerrainMap({ ...good, transitions: { ...good.transitions, b2: [12, 255] } })).toThrow(
      /outside its types dictionary/,
    );
  });

  it('emits the objects layer from emla + the eald name dictionary as sparse half-cell triples', () => {
    // 1×1 grid = a 2×2 half-cell object lane. Two placements (ids 2 and 0), the rest empty (0xffff).
    // Types compact to the used names ascending by dictionary id; placements scan row-major.
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 1, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 4, 0, 0])) },
      { tag: 'emla', version: 1, payload: packX6elLayer(Uint16Array.from([0xffff, 2, 0, 0xffff])) },
      { tag: 'eald', version: 1, payload: stringList(['stones 02 grey', 'unused', 'palm 03']) },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.objects).toEqual({
      types: ['stones 02 grey', 'palm 03'],
      placements: [
        1,
        0,
        1, // (hx 1, hy 0) -> palm 03 (dictionary id 2 -> compact 1)
        0,
        1,
        0, // (hx 0, hy 1) -> stones 02 grey (dictionary id 0 -> compact 0)
      ],
    });
  });

  it('emits per-placement levels from the lmlv state lane, parallel to the triples', () => {
    // Same 2×2 half-cell lane as above + an lmlv byte lane: the state under each PLACED half-cell
    // rides along (order = placement scan order); empty half-cells' states are dropped.
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 1, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 4, 0, 0])) },
      { tag: 'emla', version: 1, payload: packX6elLayer(Uint16Array.from([0xffff, 2, 0, 0xffff])) },
      { tag: 'lmlv', version: 1, payload: packMapLayer(Uint8Array.from([0, 3, 100, 0])) },
      { tag: 'eald', version: 1, payload: stringList(['stones 02 grey', 'unused', 'palm 03']) },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.objects?.placements).toEqual([1, 0, 1, 0, 1, 0]);
    expect(terrain.objects?.levels).toEqual([3, 100]); // palm at state 3, wall-style sentinel kept verbatim
  });

  it('emits the per-cell elevation lane from lmhe (one byte per cell, not half-cell)', () => {
    // 2×1 grid: lmlt is the 4×2 half-cell object lane, but lmhe is PER CELL — exactly width·height
    // values (2), carried through verbatim (raw byte height, 0..250 observed).
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 2, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0])) },
      { tag: 'lmhe', version: 1, payload: packMapLayer(Uint8Array.from([12, 234])) },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.elevation).toEqual([12, 234]);
  });

  it('degrades a wrong-sized lmhe lane to a grid-only artifact (warn, keep the nav grid)', () => {
    // The lmhe lane carries the half-cell count (4) instead of the per-cell count (1) — a dims
    // mismatch drops only the optional elevation layer, never the nav grid.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 1, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 0, 0, 0])) },
      { tag: 'lmhe', version: 1, payload: packMapLayer(Uint8Array.from([5, 5, 5, 5])) },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.typeIds).toEqual([1]); // the nav grid survives
    expect(terrain.elevation).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/elevation lane unreadable.*expected 1/));
    warn.mockRestore();
  });

  it('emits the per-cell brightness lane from embr (baked shading, carried verbatim)', () => {
    // Like lmhe, embr is PER CELL — exactly width·height values. 127 = neutral, 0 = the border
    // fade-to-black, >127 = baked slope light; all carried through untouched (the response curve is
    // render-side).
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 2, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 0, 0, 0, 0, 0, 0, 0])) },
      { tag: 'embr', version: 1, payload: packMapLayer(Uint8Array.from([0, 200])) },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.brightness).toEqual([0, 200]);
  });

  it('degrades a wrong-sized embr lane to a grid-only artifact (warn, keep the nav grid)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 1, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 0, 0, 0])) },
      { tag: 'embr', version: 1, payload: packMapLayer(Uint8Array.from([5, 5, 5, 5])) },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.typeIds).toEqual([1]); // the nav grid survives
    expect(terrain.brightness).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/brightness lane unreadable.*expected 1/));
    warn.mockRestore();
  });

  it('omits ground/objects/elevation/brightness when the map lacks the lanes (an lmlt-only save)', () => {
    const terrain = mapDatToTerrain(buildMapDat(1, 1, [2, 2, 2, 2]));
    expect(terrain.ground).toBeUndefined();
    expect(terrain.objects).toBeUndefined();
    expect(terrain.elevation).toBeUndefined();
    expect(terrain.brightness).toBeUndefined();
  });

  it('degrades a corrupt render lane to a grid-only artifact (warn, keep the nav grid)', () => {
    // The empa lane indexes outside its dictionary — the whole map used to be skipped for this,
    // dropping a nav grid that decoded fine; now only the optional render layer is dropped.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bytes = encodeMapDat([
      { tag: 'lsiz', version: 1, payload: encodeMapSize({ width: 1, height: 1 }) },
      { tag: 'lmlt', version: 1, payload: packMapLayer(Uint8Array.from([0, 0, 0, 0])) },
      { tag: 'empa', version: 1, payload: packX6elLayer(Uint16Array.from([7])) },
      { tag: 'empb', version: 1, payload: packX6elLayer(Uint16Array.from([0])) },
      { tag: 'eapd', version: 1, payload: stringList(['border']) },
    ]);
    const terrain = mapDatToTerrain(bytes);
    expect(terrain.typeIds).toEqual([1]); // the nav grid survives
    expect(terrain.ground).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ground lanes unreadable.*eapd dictionary/));
    warn.mockRestore();
  });
});
