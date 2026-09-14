import { describe, expect, it } from 'vitest';
import { parseMapsIndex } from '../src/content/maps-index.js';

/**
 * The menu's `/maps-index` narrowing (the JSON boundary between the dev-server middleware and the
 * map cards). Rendering itself is DOM work a human signs off in the browser; what is proven here is
 * the per-entry tolerance - a malformed sidecar field degrades that one card, never the list.
 */
describe('parseMapsIndex', () => {
  it('keeps well-formed entries with optional name/description and the minimap flag', () => {
    expect(
      parseMapsIndex([
        { id: 'blekiny_nurt', name: 'BŁĘKITNY NURT', description: 'Dolina Nilu', minimap: true },
        { id: 'bare_map', minimap: false },
      ]),
    ).toEqual([
      { id: 'blekiny_nurt', name: 'BŁĘKITNY NURT', description: 'Dolina Nilu', minimap: true },
      { id: 'bare_map', minimap: false },
    ]);
  });

  it('retains validated provenance and drops malformed source claims', () => {
    const provenance = { kind: 'user', folder: 'UserMaps/island', layer: 'game' };
    const entries = parseMapsIndex([
      { id: 'island', provenance },
      { id: 'bad', provenance: { ...provenance, folder: '../escape' } },
    ]);
    expect(entries[0]?.provenance).toEqual(provenance);
    expect(entries[1]?.provenance).toBeUndefined();
  });

  it('drops entries without a string id and ignores wrong-typed optional fields', () => {
    expect(
      parseMapsIndex([
        { id: '' },
        { name: 'no id' },
        'a-plain-string',
        null,
        { id: 'ok', name: 42, description: ['x'], minimap: 'yes' },
      ]),
    ).toEqual([{ id: 'ok', minimap: false }]);
  });

  it('yields an empty list for a non-array response', () => {
    expect(parseMapsIndex(undefined)).toEqual([]);
    expect(parseMapsIndex({ maps: [] })).toEqual([]);
    expect(parseMapsIndex('nope')).toEqual([]);
  });

  it('passes the maptype listing header through and drops wrong-typed codes and flags', () => {
    expect(
      parseMapsIndex([
        { id: 'arena', minimap: false, mapTypes: [4, 'x', 6], multiplayerOnly: true },
        { id: 'story', minimap: false, mapTypes: 'yes', multiplayerOnly: 'yes' },
      ]),
    ).toEqual([
      { id: 'arena', minimap: false, mapTypes: [4, 6], multiplayerOnly: true },
      { id: 'story', minimap: false },
    ]);
  });

  it('narrows the player roster and drops wrong-typed slots', () => {
    expect(
      parseMapsIndex([
        {
          id: 'arena',
          minimap: false,
          players: [
            { player: 0, type: 'human', tribeId: 1, colorId: 7, name: 'Ragnar' },
            { player: 1, type: 'ai', tribeId: 4, colorId: 9 },
            { player: 2, type: 'robot', tribeId: 1, colorId: 0 },
            { player: -1, type: 'human', tribeId: 1, colorId: 0 },
          ],
        },
        { id: 'bare', minimap: false, players: 'nope' },
      ]),
    ).toEqual([
      {
        id: 'arena',
        minimap: false,
        players: [
          // Without lobby fields, claimable follows the authored type (an older sidecar shape).
          {
            player: 0,
            type: 'human',
            tribeId: 1,
            colorId: 7,
            name: 'Ragnar',
            claimable: true,
            hidden: false,
            aiAllowed: true,
          },
          { player: 1, type: 'ai', tribeId: 4, colorId: 9, claimable: false, hidden: false, aiAllowed: true },
        ],
      },
      { id: 'bare', minimap: false },
    ]);
  });

  it('carries the lobby fields: claimable/hidden slots and colour locking', () => {
    expect(
      parseMapsIndex([
        {
          id: 'bridges',
          minimap: true,
          fixedColors: true,
          players: [
            {
              player: 0,
              type: 'ai',
              tribeId: 1,
              colorId: 1,
              claimable: true,
              hidden: false,
              aiAllowed: true,
            },
            {
              player: 1,
              type: 'ai',
              tribeId: 1,
              colorId: 9,
              claimable: false,
              hidden: true,
              aiAllowed: true,
            },
            // A Human/Closed-only playeroption row (47 corpus rows offer no AI).
            {
              player: 2,
              type: 'human',
              tribeId: 1,
              colorId: 2,
              claimable: true,
              hidden: false,
              aiAllowed: false,
            },
          ],
        },
      ]),
    ).toEqual([
      {
        id: 'bridges',
        minimap: true,
        fixedColors: true,
        players: [
          { player: 0, type: 'ai', tribeId: 1, colorId: 1, claimable: true, hidden: false, aiAllowed: true },
          { player: 1, type: 'ai', tribeId: 1, colorId: 9, claimable: false, hidden: true, aiAllowed: true },
          {
            player: 2,
            type: 'human',
            tribeId: 1,
            colorId: 2,
            claimable: true,
            hidden: false,
            aiAllowed: false,
          },
        ],
      },
    ]);
  });
});
