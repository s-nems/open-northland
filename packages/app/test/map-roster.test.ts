import { describe, expect, it } from 'vitest';
import { playerNameMap, playerTribe } from '../src/game/map-roster.js';
import { PRIMARY_TRIBE } from '../src/game/rules.js';

/** `TRIBE_TYPE_HUMAN_*` codes the map roster carries. */
const FRANK = 2;
const BYZANTINE = 3;
const SARACEN = 4;

describe('playerTribe', () => {
  it('reads each seat’s own roster tribe, so a non-viking seat stamps what it raises', () => {
    // `gringo_sub`'s shape: seat 0 is frank and starts with settlers of four tribes and no building,
    // so a building stamped viking would be unstaffable by every settler the seat owns.
    const script = {
      players: [
        { player: 0, type: 'human' as const, tribeId: FRANK, colorId: 4 },
        { player: 1, type: 'ai' as const, tribeId: SARACEN, colorId: 9 },
      ],
    };
    expect(playerTribe(script, 0)).toBe(FRANK);
    expect(playerTribe(script, 1)).toBe(SARACEN);
  });

  it('falls back off-roster and for a map that ships no roster', () => {
    const script = { players: [{ player: 0, type: 'human' as const, tribeId: BYZANTINE, colorId: 1 }] };
    expect(playerTribe(script, 5)).toBe(PRIMARY_TRIBE);
    expect(playerTribe(null, 0)).toBe(PRIMARY_TRIBE);
  });
});

describe('playerNameMap', () => {
  it('names the seats the roster names, and only those', () => {
    // Same tribe on both seats: the authored name is the only thing telling them apart.
    const nameOf = playerNameMap(
      {
        players: [
          { player: 0, type: 'human' as const, tribeId: 1, colorId: 7, name: { pol: 'Zachodni Wikingowie' } },
          { player: 1, type: 'ai' as const, tribeId: 1, colorId: 9 },
        ],
      },
      'pol',
    );
    expect(nameOf(0)).toBe('Zachodni Wikingowie');
    expect(nameOf(1)).toBeUndefined(); // roster row without a name
    expect(nameOf(5)).toBeUndefined(); // off-roster
  });

  it('reads a seat name in the given language, else in the one the map ships', () => {
    const nameOf = playerNameMap(
      {
        players: [
          {
            player: 0,
            type: 'human' as const,
            tribeId: 1,
            colorId: 0,
            name: { pol: 'Wikingowie z Grasslandu', eng: 'Vikings from Grassland' },
          },
          { player: 1, type: 'ai' as const, tribeId: 2, colorId: 1, name: { pol: 'Frankowie' } },
        ],
      },
      'eng',
    );
    expect(nameOf(0)).toBe('Vikings from Grassland');
    expect(nameOf(1)).toBe('Frankowie');
  });

  it('names nothing for a roster-less map, which leaves the header on the slot id', () => {
    expect(playerNameMap(null, 'eng')(0)).toBeUndefined();
  });
});
