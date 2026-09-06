import type { PlacementOverlayFrame } from '@open-northland/render';
import { describe, expect, it } from 'vitest';
import { type PlacementCursorInput, placementCursor } from '../src/view/runtime/placement-cursor.js';

/** Two distinct washes, so an assertion says which probe answered. The renderer only forwards them. */
const BUILDING_WASH: PlacementOverlayFrame = { minCol: 0, maxCol: 8, minRow: 0, maxRow: 8, blocked: [] };
const SIGNPOST_WASH: PlacementOverlayFrame = { minCol: 1, maxCol: 9, minRow: 1, maxRow: 9, blocked: [] };

const HOUSE = 7;
const LOCAL_PLAYER = 2;
const SARACEN = 4;
const TILE = { col: 4, row: 9 };

/** A frame with nothing held: each case turns on what it is about. The probe counters let a case prove
 *  the frame walked no band and never asked where the cursor is - both are per-frame scans. */
function frame(over: Partial<PlacementCursorInput> = {}) {
  let tileProbes = 0;
  let signpostProbes = 0;
  const input: PlacementCursorInput = {
    placementType: null,
    signpostActive: false,
    buildingOverlay: () => BUILDING_WASH,
    signpostOverlay: () => {
      signpostProbes++;
      return SIGNPOST_WASH;
    },
    tileAt: () => {
      tileProbes++;
      return TILE;
    },
    canPlaceAt: () => true,
    canPlaceSignpostAt: () => true,
    localPlayer: LOCAL_PLAYER,
    placementTribe: SARACEN,
    ...over,
  };
  return {
    cursor: () => placementCursor(input),
    tileProbes: () => tileProbes,
    signpostProbes: () => signpostProbes,
  };
}

describe('placement cursor', () => {
  it('paints nothing and never probes the cursor tile outside a placement mode', () => {
    const f = frame();

    expect(f.cursor()).toEqual({ overlay: null, ghost: null });
    expect(f.tileProbes()).toBe(0);
  });

  it('washes the ground and floats the held building over a tile that accepts it', () => {
    const f = frame({ placementType: HOUSE });

    expect(f.cursor()).toEqual({
      overlay: BUILDING_WASH,
      ghost: { kind: 'building', col: TILE.col, row: TILE.row, buildingType: HOUSE, tribe: SARACEN },
    });
  });

  it('keeps the wash but hides the ghost over rejecting ground', () => {
    const f = frame({ placementType: HOUSE, canPlaceAt: () => false });

    expect(f.cursor()).toEqual({ overlay: BUILDING_WASH, ghost: null });
  });

  it('hides the ghost while the pointer is off the canvas', () => {
    const f = frame({ placementType: HOUSE, tileAt: () => null });

    expect(f.cursor()).toEqual({ overlay: BUILDING_WASH, ghost: null });
  });

  it('shows the pending signpost with its own wash and the owner slot', () => {
    const f = frame({ signpostActive: true });

    expect(f.cursor()).toEqual({
      overlay: SIGNPOST_WASH,
      ghost: { kind: 'signpost', col: TILE.col, row: TILE.row, player: LOCAL_PLAYER },
    });
  });

  it('refuses a signpost ghost where the erect would be rejected', () => {
    const f = frame({ signpostActive: true, canPlaceSignpostAt: () => false });

    expect(f.cursor()).toEqual({ overlay: SIGNPOST_WASH, ghost: null });
  });

  it('lets a held building win over a pending signpost, without walking the signpost band', () => {
    const f = frame({ placementType: HOUSE, signpostActive: true });

    expect(f.cursor()).toEqual({
      overlay: BUILDING_WASH,
      ghost: { kind: 'building', col: TILE.col, row: TILE.row, buildingType: HOUSE, tribe: SARACEN },
    });
    expect(f.signpostProbes()).toBe(0);
  });

  it('still floats the held building when its own band probe has no wash to draw', () => {
    const f = frame({ placementType: HOUSE, buildingOverlay: () => null });

    expect(f.cursor()).toEqual({
      overlay: null,
      ghost: { kind: 'building', col: TILE.col, row: TILE.row, buildingType: HOUSE, tribe: SARACEN },
    });
  });

  it('drops the signpost ghost when its band probe has no frame to draw', () => {
    const f = frame({ signpostActive: true, signpostOverlay: () => null });

    expect(f.cursor()).toEqual({ overlay: null, ghost: null });
    expect(f.tileProbes()).toBe(0);
  });
});
