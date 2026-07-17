import { describe, expect, it } from 'vitest';
import { colorOverridesParam, localPlayerParam, playerColourMap } from '../src/game/player-session.js';

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
});

describe('colorOverridesParam', () => {
  it('parses slot:colorId pairs and drops malformed ones', () => {
    const overrides = colorOverridesParam(new URLSearchParams('colors=0:7,2:3,x:1,4:-2'));
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
