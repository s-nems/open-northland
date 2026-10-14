import { describe, expect, it } from 'vitest';
import { newDrawItem } from '../src/data/scene/draw-item.js';
import { assignStaticFields, copyStaticFields } from '../src/data/scene/snapshot-readers/static-readers.js';
import { buildingLandscapeOverlays } from '../src/data/sprites/layered.js';
import type { BuildingTypeBinding } from '../src/data/sprites/layered-bindings.js';

describe('scripted house layers', () => {
  it('reads on/off slots, retains them in fog and drops layers during construction', () => {
    const item = newDrawItem('building', 1, 0, 0, 0, undefined);
    assignStaticFields(item, 'building', {
      Building: { buildingType: 42, tribe: 2, built: 65536 },
      HouseLandscapeOverlays: {
        slots: new Map([
          [0, true],
          [1, false],
          [6, true],
        ]),
      },
    });
    expect(item.landscapeOverlayMask).toBe(65);
    const ghost = newDrawItem('building', 1, 0, 0, 0, undefined);
    copyStaticFields(ghost, item);
    expect(ghost.landscapeOverlayMask).toBe(65);
    const overlays = [{ slot: 0, layer: 'flame', frames: [4], x: 0, y: 0, animated: false }];
    const binding: BuildingTypeBinding = {
      byType: { 42: 1 },
      default: 1,
      landscapeOverlaysByType: { 42: overlays },
    };
    expect(buildingLandscapeOverlays(binding, item)).toBe(overlays);
    expect(buildingLandscapeOverlays(binding, { ...item, builtPct: 50 })).toEqual([]);
    expect(buildingLandscapeOverlays(binding, { ...item, landscapeOverlayMask: 0 })).toEqual([]);
  });
});
