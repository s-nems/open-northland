import type { PlacementOverlayFrame } from '@open-northland/render';
import type { Paper } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type PlacementCursorInput, placementCursor } from '../src/view/runtime/placement-cursor.js';

/** Two distinct washes, so an assertion says which probe answered. The renderer only forwards them. */
const BUILDING_WASH: PlacementOverlayFrame = { minCol: 0, maxCol: 8, minRow: 0, maxRow: 8, blocked: [] };
const SIGNPOST_WASH: PlacementOverlayFrame = { minCol: 1, maxCol: 9, minRow: 1, maxRow: 9, blocked: [] };
const LINE_WASH: PlacementOverlayFrame = { minCol: 2, maxCol: 7, minRow: 2, maxRow: 7, blocked: [] };
const DOCK_WASH: PlacementOverlayFrame = { minCol: 2, maxCol: 10, minRow: 2, maxRow: 10, blocked: [] };
const SHIP = 31;

const HOUSE = 7;
const LOCAL_PLAYER = 2;
const SARACEN = 4;
const TILE = { col: 4, row: 9 };

/** A frame with nothing held: each case turns on what it is about. The probe counters let a case prove
 *  the frame walked no band and never asked where the cursor is - both are per-frame scans. */
function frame(over: Partial<PlacementCursorInput> = {}) {
  let tileProbes = 0;
  let signpostProbes = 0;
  let dockProbes = 0;
  const input: PlacementCursorInput = {
    placementType: null,
    placementPaper: null,
    signpostActive: false,
    dockVehicle: null,
    buildingOverlay: () => BUILDING_WASH,
    signpostOverlay: () => {
      signpostProbes++;
      return SIGNPOST_WASH;
    },
    dockOverlay: () => {
      dockProbes++;
      return DOCK_WASH;
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
    dockProbes: () => dockProbes,
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

  it('passes a held paper to the probe so its technology bypass also governs the ghost', () => {
    const paper: Paper = { kind: 'placeAny', param: 0 };
    const gatePapers: Array<Paper | undefined> = [];
    const overlayPapers: Array<Paper | undefined> = [];
    const f = frame({
      placementType: HOUSE,
      placementPaper: paper,
      buildingOverlay: (_type, activePaper) => {
        overlayPapers.push(activePaper);
        return BUILDING_WASH;
      },
      canPlaceAt: (_type, _col, _row, activePaper) => {
        gatePapers.push(activePaper);
        return activePaper !== undefined;
      },
    });

    expect(f.cursor().ghost?.kind).toBe('building');
    expect(gatePapers).toEqual([paper]);
    expect(overlayPapers).toEqual([paper]);
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

  it('draws the marker under the cursor with no wash before a wall line starts', () => {
    const nodes = [{ col: 4, row: 9, state: 'open' as const }];
    const f = frame({
      palisadeGfxIndex: 691,
      signpostActive: true,
      palisadePreview: () => nodes,
      anchored: false,
      palisadeWash: () => null,
    });

    expect(f.cursor()).toEqual({ overlay: null, ghost: { kind: 'line', nodes, anchored: false } });
    expect(f.signpostProbes()).toBe(0);
  });

  it('washes around a started line and draws it from its anchor', () => {
    const nodes = [
      { col: 4, row: 9, state: 'built' as const },
      { col: 5, row: 9, state: 'open' as const },
      { col: 6, row: 9, state: 'blocked' as const },
    ];
    const f = frame({
      palisadeGfxIndex: 691,
      palisadePreview: () => nodes,
      anchored: true,
      palisadeWash: () => LINE_WASH,
    });

    expect(f.cursor()).toEqual({ overlay: LINE_WASH, ghost: { kind: 'line', nodes, anchored: true } });
  });

  it('draws the gate the gate tool would cut in place of its span markers', () => {
    const gate = { col: 6, row: 9, gfxIndex: 698, ok: true };
    const f = frame({
      palisadeGfxIndex: 696,
      gatePreview: () => gate,
      palisadePreview: () => [{ col: 6, row: 9, state: 'blocked' as const }],
      palisadeWash: () => LINE_WASH,
    });

    expect(f.cursor()).toEqual({ overlay: LINE_WASH, ghost: { kind: 'gate', ...gate } });
  });

  it('keeps the wash of a started line while the pointer is off the map', () => {
    const f = frame({
      palisadeGfxIndex: 691,
      tileAt: () => null,
      palisadePreview: () => [],
      anchored: true,
      palisadeWash: () => LINE_WASH,
    });

    expect(f.cursor()).toEqual({ overlay: LINE_WASH, ghost: null });
  });

  it('washes the mooring spots of an armed dock pick with no ghost and no cursor probe', () => {
    const f = frame({ dockVehicle: SHIP });

    expect(f.cursor()).toEqual({ overlay: DOCK_WASH, ghost: null });
    expect(f.dockProbes()).toBe(1);
    expect(f.tileProbes()).toBe(0);
  });

  it('lets a held building or a pending signpost win over an armed dock pick', () => {
    const building = frame({ placementType: HOUSE, dockVehicle: SHIP });
    expect(building.cursor().overlay).toBe(BUILDING_WASH);
    expect(building.dockProbes()).toBe(0);
    const signpost = frame({ signpostActive: true, dockVehicle: SHIP });
    expect(signpost.cursor().overlay).toBe(SIGNPOST_WASH);
    expect(signpost.dockProbes()).toBe(0);
  });

  it('drops the signpost ghost when its band probe has no frame to draw', () => {
    const f = frame({ signpostActive: true, signpostOverlay: () => null });

    expect(f.cursor()).toEqual({ overlay: null, ghost: null });
    expect(f.tileProbes()).toBe(0);
  });
});
