import { terrainWorldBounds, tileToScreen } from '@open-northland/render';
import { FOG_MODE, FOG_STATE, type FogView, fx } from '@open-northland/sim';
import { describe, expect, it } from 'vitest';
import { PLAYER_SWATCH_COLORS } from '../src/catalog/roster.js';
import { forEachMinimapDot } from '../src/hud/minimap/dots.js';
import { type Ent, snapshotOf } from './support/snapshot.js';

const BOUNDS = terrainWorldBounds(8, 8);
const SCALE = 0.5;
const SETTLER_HALF = 1; // SETTLER_DOT_PX / 2
const BUILDING_HALF = 1.5; // BUILDING_DOT_PX / 2

interface Dot {
  bx: number;
  by: number;
  half: number;
  colour: number;
}

function dotsOf(
  entities: readonly Ent[],
  fog: FogView | null = null,
  playerColourOf?: (player: number) => number,
): Dot[] {
  const out: Dot[] = [];
  forEachMinimapDot(snapshotOf(entities), fog, BOUNDS, SCALE, playerColourOf, (bx, by, half, colour) =>
    out.push({ bx, by, half, colour }),
  );
  return out;
}

/** Where the raster stamps a force standing on tile `(x, y)` - the projection the dots must reproduce. */
function pxAt(x: number, y: number): { bx: number; by: number } {
  const s = tileToScreen(x, y);
  return { bx: (s.x - BOUNDS.minX) * SCALE, by: (s.y - BOUNDS.minY) * SCALE };
}

function owned(id: number, kind: 'Settler' | 'Building', player: number, x: number, y: number): Ent {
  return {
    id,
    components: { [kind]: {}, Owner: { player }, Position: { x: fx.fromInt(x), y: fx.fromInt(y) } },
  };
}

/** A FogView whose visibility is decided per cell by `visible` (missing cells read as EXPLORED). */
function fogWhere(visible: (cellX: number, cellY: number) => boolean): FogView {
  return {
    mode: FOG_MODE.RECON_FOG_OF_WAR,
    cellsWide: 8,
    cellsHigh: 8,
    generation: 1,
    stateAt: (cx, cy) => (visible(cx, cy) ? FOG_STATE.VISIBLE : FOG_STATE.EXPLORED),
  };
}

describe('forEachMinimapDot', () => {
  it('projects each owned settler and building at its raster px, sized and coloured by kind and player', () => {
    const dots = dotsOf([owned(1, 'Settler', 0, 2, 3), owned(2, 'Building', 1, 4, 5)]);
    expect(dots).toEqual([
      { ...pxAt(2, 3), half: SETTLER_HALF, colour: PLAYER_SWATCH_COLORS[0] },
      { ...pxAt(4, 5), half: BUILDING_HALF, colour: PLAYER_SWATCH_COLORS[1] },
    ]);
  });

  it('plots only owned settlers and buildings that have a position', () => {
    const dots = dotsOf([
      { id: 1, components: { Building: {}, Position: { x: fx.fromInt(1), y: fx.fromInt(1) } } }, // no owner
      {
        id: 2,
        components: { Signpost: {}, Owner: { player: 0 }, Position: { x: fx.fromInt(2), y: fx.fromInt(2) } },
      }, // neither settler nor building
      { id: 3, components: { Settler: {}, Owner: { player: 0 } } }, // no position
      owned(4, 'Settler', 0, 6, 6),
    ]);
    expect(dots).toEqual([{ ...pxAt(6, 6), half: SETTLER_HALF, colour: PLAYER_SWATCH_COLORS[0] }]);
  });

  it('drops forces on fogged ground and keeps the visible ones', () => {
    const forces = [owned(1, 'Settler', 0, 2, 2), owned(2, 'Settler', 0, 6, 6)];
    const nearHalfVisible = fogWhere((cellX) => cellX < 4);
    expect(dotsOf(forces, nearHalfVisible)).toEqual([
      { ...pxAt(2, 2), half: SETTLER_HALF, colour: PLAYER_SWATCH_COLORS[0] },
    ]);
    expect(dotsOf(forces, null)).toHaveLength(2); // no fog view: every force shows
  });

  it('remaps the swatch through playerColourOf and wraps the raw player index modulo the table', () => {
    const remapped = dotsOf([owned(1, 'Settler', 5, 0, 0)], null, () => 1);
    expect(remapped[0]?.colour).toBe(PLAYER_SWATCH_COLORS[1]);

    const wrapped = dotsOf([owned(1, 'Settler', PLAYER_SWATCH_COLORS.length, 0, 0)]);
    expect(wrapped[0]?.colour).toBe(PLAYER_SWATCH_COLORS[0]);
  });

  it('emits nothing for an empty world', () => {
    expect(dotsOf([])).toEqual([]);
  });
});
