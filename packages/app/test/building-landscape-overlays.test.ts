import { describe, expect, it } from 'vitest';
import {
  landscapeOverlayFamilies,
  landscapeOverlayRefs,
} from '../src/content/building-gfx/landscape-overlays.js';
import type { ContentIr } from '../src/content/ir/rows.js';

const ir: ContentIr = {
  buildingLandscapeOverlays: [
    { tribeId: 2, typeId: 42, level: 0, slot: 0, x: 4, y: -5, landscape: 'Flame', editName: 'test' },
    { tribeId: 2, typeId: 42, level: 0, slot: 1, x: 0, y: 0, landscape: 'Missing', editName: 'test' },
  ],
  landscapeGfx: [
    {
      index: 0,
      editName: 'Flame',
      logicType: 0,
      bmd: 'art/flame.bmd',
      paletteName: 'fire',
      frames: [{ state: 0, bobIds: [4, 5] }],
      loopAnimation: true,
    },
  ],
};
describe('landscape overlay bindings', () => {
  it('resolves exact authored names, preserves offsets and skips missing graphics', () => {
    expect(landscapeOverlayRefs(ir, 2)[42]).toEqual([
      { slot: 0, layer: 'flame.fire', frames: [4, 5], x: 4, y: -5, animated: true },
    ]);
    expect(landscapeOverlayRefs(ir, 1)).toEqual({});
    expect(landscapeOverlayRefs(ir, 2, 'other')).toEqual({});
    expect(landscapeOverlayFamilies(ir)).toEqual([{ tribeId: 2, bmd: 'art/flame.bmd', paletteName: 'fire' }]);
  });
});
