import { describe, expect, it } from 'vitest';
import {
  colorOverridesParam,
  localPlayerParam,
  observerParam,
  playerColourMap,
  readOnlyObserverParam,
} from '../src/game/player-session.js';

/**
 * The `?map=` player-session params (menu roster → game): the controlled seat, the `?colors=`
 * overrides, and the owner→team-colour mapping the renderer/minimap consume.
 */
describe('localPlayerParam', () => {
  it('reads a valid seat and falls back to slot 0 otherwise', () => {
    expect(localPlayerParam(new URLSearchParams('player=3'))).toBe(3);
    expect(localPlayerParam(new URLSearchParams(''))).toBe(0);
    expect(localPlayerParam(new URLSearchParams('player=abc'))).toBe(0);
    expect(localPlayerParam(new URLSearchParams('player=-1'))).toBe(0);
    expect(localPlayerParam(new URLSearchParams('player=99'))).toBe(0); // beyond MAX_PLAYERS
  });

  it('reads observer and overseer as spectator sessions, seat reads falling back to slot 0', () => {
    expect(observerParam(new URLSearchParams('player=observer'))).toBe(true);
    expect(observerParam(new URLSearchParams('player=overseer'))).toBe(true);
    expect(observerParam(new URLSearchParams('player=2'))).toBe(false);
    expect(observerParam(new URLSearchParams(''))).toBe(false);
    expect(localPlayerParam(new URLSearchParams('player=observer'))).toBe(0);
    expect(localPlayerParam(new URLSearchParams('player=overseer'))).toBe(0);
  });

  it('marks only the observer read-only — the overseer god-mode keeps control', () => {
    expect(readOnlyObserverParam(new URLSearchParams('player=observer'))).toBe(true);
    expect(readOnlyObserverParam(new URLSearchParams('player=overseer'))).toBe(false);
    expect(readOnlyObserverParam(new URLSearchParams('player=2'))).toBe(false);
    expect(readOnlyObserverParam(new URLSearchParams(''))).toBe(false);
  });
});

describe('colorOverridesParam', () => {
  it('parses slot:colorId pairs and drops malformed or out-of-range ones', () => {
    // 4:-2 and 5:99 drop: an out-of-range colour would render differently per consumer (the
    // sprite LUT clamps, the minimap wraps, the signpost atlas misses).
    const overrides = colorOverridesParam(new URLSearchParams('colors=0:7,2:3,x:1,4:-2,5:99'));
    expect([...overrides.entries()]).toEqual([
      [0, 7],
      [2, 3],
    ]);
    expect(colorOverridesParam(new URLSearchParams('')).size).toBe(0);
  });
});

describe('playerColourMap', () => {
  const script = {
    players: [
      { player: 0, type: 'human' as const, tribeId: 1, colorId: 7 },
      { player: 1, type: 'ai' as const, tribeId: 2, colorId: 9 },
    ],
  };

  it('maps roster colours, overrides win, and off-roster players keep their slot id', () => {
    const colourOf = playerColourMap(script, new Map([[1, 4]]));
    expect(colourOf(0)).toBe(7); // authored orange
    expect(colourOf(1)).toBe(4); // override green over authored black
    expect(colourOf(5)).toBe(5); // off-roster → identity
  });

  it('is identity for a roster-less map (scenes keep player id = colour slot)', () => {
    const colourOf = playerColourMap(null, new Map());
    expect(colourOf(0)).toBe(0);
    expect(colourOf(3)).toBe(3);
  });
});
