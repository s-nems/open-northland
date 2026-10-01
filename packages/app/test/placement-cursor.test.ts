import type { PlacementOverlayFrame } from '@open-northland/render';
import type { Paper } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { type PlacementCursorInput, placementCursor } from '../src/view/runtime/placement-cursor.js';

/** Two distinct washes, so an assertion says which probe answered. The renderer only forwards them. */
const BUILDING_WASH: PlacementOverlayFrame = {
  minCol: 0,
  maxCol: 8,
  minRow: 0,
  maxRow: 8,
  blocked: [],
  reserved: [],
};
const SIGNPOST_WASH: PlacementOverlayFrame = {
  minCol: 1,
  maxCol: 9,
  minRow: 1,
  maxRow: 9,
  blocked: [],
  reserved: [],
};
const LINE_WASH: PlacementOverlayFrame = {
  minCol: 2,
  maxCol: 7,
  minRow: 2,
  maxRow: 7,
  blocked: [],
  reserved: [],
};
const DOCK_WASH: PlacementOverlayFrame = {
  minCol: 2,
  maxCol: 10,
  minRow: 2,
  maxRow: 10,
  blocked: [],
  reserved: [],
};
const SHIP = 31;

const HOUSE = 7;
const LOCAL_PLAYER = 2;
const SARACEN = 4;
const TILE = { col: 4, row: 9 };
/** A Saracen house held by the seat, whose nation the ghost and the probes take. */
const HELD = { typeId: HOUSE, tribe: SARACEN, paper: null };

/** A frame with nothing held: each case turns on what it is about. The probe counters let a case prove
 *  the frame walked no band and never asked where the cursor is - both are per-frame scans. */
function frame(over: Partial<PlacementCursorInput> = {}) {
  let tileProbes = 0;
  let signpostProbes = 0;
  let dockProbes = 0;
  const input: PlacementCursorInput = {
    building: null,
    signpostActive: false,
    dockVehicle: null,
    flagActive: false,
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
    const f = frame({ building: HELD });

    expect(f.cursor()).toEqual({
      overlay: BUILDING_WASH,
      ghost: { kind: 'building', col: TILE.col, row: TILE.row, buildingType: HOUSE, tribe: SARACEN },
    });
  });

  it('keeps the wash but hides the ghost over rejecting ground', () => {
    const f = frame({ building: HELD, canPlaceAt: () => false });

    expect(f.cursor()).toEqual({ overlay: BUILDING_WASH, ghost: null });
  });

  it("passes the held nation and paper to the probes, so the paper's bypass and the nation's footprint govern the ghost", () => {
    const paper: Paper = { kind: 'placeAny', param: 0 };
    const gateAsks: Array<readonly [number, Paper | undefined]> = [];
    const overlayAsks: Array<readonly [number, Paper | null]> = [];
    const f = frame({
      building: { ...HELD, paper },
      buildingOverlay: (held) => {
        overlayAsks.push([held.tribe, held.paper]);
        return BUILDING_WASH;
      },
      canPlaceAt: (_type, tribe, _col, _row, activePaper) => {
        gateAsks.push([tribe, activePaper]);
        return activePaper !== undefined;
      },
    });

    expect(f.cursor().ghost).toMatchObject({ kind: 'building', tribe: SARACEN });
    expect(gateAsks).toEqual([[SARACEN, paper]]);
    expect(overlayAsks).toEqual([[SARACEN, paper]]);
  });

  it('hides the ghost while the pointer is off the canvas', () => {
    const f = frame({ building: HELD, tileAt: () => null });

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
    const f = frame({ building: HELD, signpostActive: true });

    expect(f.cursor()).toEqual({
      overlay: BUILDING_WASH,
      ghost: { kind: 'building', col: TILE.col, row: TILE.row, buildingType: HOUSE, tribe: SARACEN },
    });
    expect(f.signpostProbes()).toBe(0);
  });

  it('still floats the held building when its own band probe has no wash to draw', () => {
    const f = frame({ building: HELD, buildingOverlay: () => null });

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
    const building = frame({ building: HELD, dockVehicle: SHIP });
    expect(building.cursor().overlay).toBe(BUILDING_WASH);
    expect(building.dockProbes()).toBe(0);
    const signpost = frame({ signpostActive: true, dockVehicle: SHIP });
    expect(signpost.cursor().overlay).toBe(SIGNPOST_WASH);
    expect(signpost.dockProbes()).toBe(0);
  });

  it('floats the work flag under the cursor without a wash while a flag pick is armed', () => {
    const f = frame({ flagActive: true });

    expect(f.cursor()).toEqual({ overlay: null, ghost: { kind: 'flag', col: TILE.col, row: TILE.row } });
    expect(f.signpostProbes()).toBe(0);
  });

  it('hides the flag off the canvas and lets a pending signpost win over it', () => {
    expect(frame({ flagActive: true, tileAt: () => null }).cursor()).toEqual({ overlay: null, ghost: null });
    expect(frame({ flagActive: true, signpostActive: true }).cursor().ghost?.kind).toBe('signpost');
  });

  it('drops the signpost ghost when its band probe has no frame to draw', () => {
    const f = frame({ signpostActive: true, signpostOverlay: () => null });

    expect(f.cursor()).toEqual({ overlay: null, ghost: null });
    expect(f.tileProbes()).toBe(0);
  });
});
