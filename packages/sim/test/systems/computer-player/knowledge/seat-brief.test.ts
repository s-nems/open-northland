import { describe, expect, it } from 'vitest';
import type { MapBriefState } from '../../../../src/components/index.js';
import { seatBriefOf } from '../../../../src/systems/computer-player/index.js';

/** A row of eight 32-node zones: two land components split by the water in zone 4. */
const ZONE = 32;
const ZONES = 8;
const WEST_LAND = 0;
const EAST_LAND = 1;
const NO_LAND = -1;

function brief(deposits: { iron?: number; gold?: number }): MapBriefState {
  const goods = ['iron', 'gold'];
  const cells = new Array<number>(ZONES * goods.length).fill(0);
  if (deposits.iron !== undefined) cells[deposits.iron * goods.length] = 10;
  if (deposits.gold !== undefined) cells[deposits.gold * goods.length + 1] = 10;
  const zeros = () => new Array<number>(ZONES).fill(0);
  return {
    scanned: true,
    width: ZONE * ZONES,
    height: ZONE,
    zoneNodes: ZONE,
    zonesWide: ZONES,
    zonesHigh: 1,
    land: zeros(),
    water: zeros(),
    free: zeros(),
    clearable: zeros(),
    blocked: zeros(),
    plantable: zeros(),
    dominantLand: [WEST_LAND, WEST_LAND, WEST_LAND, WEST_LAND, NO_LAND, EAST_LAND, EAST_LAND, EAST_LAND],
    goods,
    deposits: cells,
    fish: zeros(),
    landComponents: [],
    seats: [
      { player: 0, hx: 16, hy: 16, component: WEST_LAND, buildings: [] },
      { player: 1, hx: 240, hy: 16, component: EAST_LAND, buildings: [] },
    ],
    livestock: [],
    entityCeiling: 0,
  };
}

describe('seat brief', () => {
  it('reaches a deposit on its own land without a ship and one across the water only over sea', () => {
    const west = seatBriefOf(brief({ iron: 6, gold: 1 }), 0);
    expect(west?.access.get('gold')).toEqual({ access: 'home', zones: 1 });
    expect(west?.access.get('iron')).toEqual({ access: 'overSea', zones: 6 });
    expect(west?.access.get('fish')).toEqual({ access: 'none', zones: null });
    expect(west?.others).toEqual([expect.objectContaining({ player: 1, direction: 'e', sameLand: false })]);
  });
});
