import { describe, expect, it } from 'vitest';
import type { NodeId, TerrainGraph } from '../../../../src/nav/terrain/index.js';
import {
  clearWay,
  lineWayClear,
  withDanger,
} from '../../../../src/systems/computer-player/colony/sea-danger.js';

const FROM = { hx: 100, hy: 10 };
const TO = { hx: 100, hy: 110 };
const IN_THE_WAY = { hx: 100, hy: 60 };
const NEAR_IT = { hx: 110, hy: 60 };
const DANGERS_MOST = 4;

/** Open water east of `shoreHx`, land west of it, one node id per column. */
function sea(shoreHx: number): TerrainGraph {
  const terrain = {
    inBounds: () => true,
    nodeAt: (hx: number) => hx as NodeId,
    isWater: (node: NodeId) => node >= shoreHx,
  };
  return terrain as unknown as TerrainGraph;
}

const LAND_WEST_OF = 0;
const NO_ROOM_WEST_OF = 1000;

describe('a colony line round fire', () => {
  const terrain = sea(LAND_WEST_OF);

  it('remembers one danger per stretch of water, up to its limit', () => {
    const one = withDanger([], IN_THE_WAY) ?? [];
    expect(one).toHaveLength(1);
    expect(withDanger(one, NEAR_IT)).toBeNull();
    const full = Array.from({ length: DANGERS_MOST }, (_, i) => ({ hx: i * 100, hy: 0 }));
    expect(withDanger(full, IN_THE_WAY)).toBeNull();
  });

  it('sails straight past no danger and turns off one in the way over open water', () => {
    expect(clearWay(terrain, [], FROM, TO)).toEqual({ via: null });
    const round = clearWay(terrain, [IN_THE_WAY], FROM, TO);
    const via = round?.via;
    if (via === null || via === undefined) throw new Error('no way round');
    expect(terrain.isWater(terrain.nodeAt(via.hx, via.hy))).toBe(true);
  });

  it('finds no way where fire closes the water', () => {
    expect(lineWayClear(sea(NO_ROOM_WEST_OF), [IN_THE_WAY], FROM, TO)).toBe(false);
    expect(lineWayClear(sea(NO_ROOM_WEST_OF), [], FROM, TO)).toBe(true);
  });
});
