import { describe, expect, it } from 'vitest';
import type { NodeId, TerrainGraph } from '../../../../../src/nav/terrain/index.js';
import {
  clearWay,
  lineWayClear,
  withDanger,
  withoutLapsed,
} from '../../../../../src/systems/computer-player/colony/sea/sea-danger.js';
import { minutesToTicks } from '../../../../../src/systems/computer-player/game-phase.js';

const FROM = { hx: 100, hy: 10 };
const TO = { hx: 100, hy: 110 };
const IN_THE_WAY = { hx: 100, hy: 60 };
const NEAR_IT = { hx: 110, hy: 60 };
const DANGERS_MOST = 4;
const HIT_AT = 1000;
const LATER = HIT_AT + minutesToTicks(20);
const LONG_AFTER = HIT_AT + minutesToTicks(40);
/** By the berth: a raider's fire on a moored ship. */
const AT_THE_BERTH = { hx: 100, hy: 20 };

function seenAt(at: { hx: number; hy: number }, seen = HIT_AT) {
  return { at, seen };
}

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
    const one = withDanger([], IN_THE_WAY, HIT_AT) ?? [];
    expect(one).toHaveLength(1);
    expect(withDanger(one, NEAR_IT, LATER)).toEqual([seenAt(IN_THE_WAY, LATER)]);
    const full = Array.from({ length: DANGERS_MOST }, (_, i) => seenAt({ hx: i * 100, hy: 0 }));
    expect(withDanger(full, IN_THE_WAY, LATER)).toBeNull();
  });

  it('forgets a danger once its fire has had time to move on', () => {
    const one = [seenAt(IN_THE_WAY)];
    expect(withoutLapsed(one, LATER)).toBeNull();
    expect(withoutLapsed(one, LONG_AFTER)).toEqual([]);
  });

  it('passes a danger at its own mooring', () => {
    expect(clearWay(sea(NO_ROOM_WEST_OF), [seenAt(AT_THE_BERTH)], FROM, TO)).toEqual({ via: null });
  });

  it('sails straight past no danger and turns off one in the way over open water', () => {
    expect(clearWay(terrain, [], FROM, TO)).toEqual({ via: null });
    const round = clearWay(terrain, [seenAt(IN_THE_WAY)], FROM, TO);
    const via = round?.via;
    if (via === null || via === undefined) throw new Error('no way round');
    expect(terrain.isWater(terrain.nodeAt(via.hx, via.hy))).toBe(true);
  });

  it('finds no way where fire closes the water', () => {
    expect(lineWayClear(sea(NO_ROOM_WEST_OF), [seenAt(IN_THE_WAY)], FROM, TO)).toBe(false);
    expect(lineWayClear(sea(NO_ROOM_WEST_OF), [], FROM, TO)).toBe(true);
  });
});
