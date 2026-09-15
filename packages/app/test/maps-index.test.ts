import { describe, expect, it } from 'vitest';
import { parseMapsIndex } from '../src/content/maps-index.js';

/**
 * The menu reads `maps-index.json` through the shared schema. The pipeline that wrote the listing is
 * the same build, so a document that does not parse is stale content: the list stays empty instead of
 * showing a guessed subset.
 */
describe('parseMapsIndex', () => {
  const arena = {
    id: 'arena',
    provenance: { kind: 'mod', folder: 'CnModMaps/arena' },
    name: 'Arena',
    description: 'Two against two.',
    minimap: true,
    players: [
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
      { player: 1, type: 'ai', tribeId: 4, colorId: 9, claimable: false, hidden: true, aiAllowed: false },
    ],
    fixedColors: true,
    mapTypes: [4, 6],
    multiplayerOnly: true,
  };

  it('keeps a well-formed listing, optional fields included', () => {
    const listing = [arena, { id: 'bare', minimap: false }];
    expect(parseMapsIndex(listing)).toEqual(listing);
  });

  it('reads an absent listing as no maps', () => {
    expect(parseMapsIndex(null)).toEqual([]);
  });

  it('reads a listing this build cannot parse as no maps', () => {
    expect(parseMapsIndex({ maps: [arena] })).toEqual([]);
    expect(parseMapsIndex([{ ...arena, provenance: { kind: 'mod', folder: '../escape' } }])).toEqual([]);
    expect(parseMapsIndex([{ ...arena, players: [{ player: 0, type: 'robot' }] }])).toEqual([]);
    expect(parseMapsIndex([{ id: 'story', minimap: false, mapTypes: 'yes' }])).toEqual([]);
  });
});
