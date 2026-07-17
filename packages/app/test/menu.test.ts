import { describe, expect, it } from 'vitest';
import {
  claimSeat,
  initialRosterState,
  rosterStartParams,
  setSlotColor,
  toggleVacantMode,
} from '../src/entries/menu/players.js';
import { MENU_FOG_MODES, MENU_SPEEDS, targetSearch } from '../src/entries/menu/settings.js';
import { parseMapsIndex } from '../src/entries/menu.js';

/**
 * The menu's `/maps-index` narrowing (the JSON boundary between the dev-server middleware and the
 * map cards). Rendering itself is DOM work a human signs off in the browser; what is proven here is
 * the per-entry tolerance — a malformed sidecar field degrades that one card, never the list.
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
          },
          { player: 1, type: 'ai', tribeId: 4, colorId: 9, claimable: false, hidden: false },
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
            { player: 0, type: 'ai', tribeId: 1, colorId: 1, claimable: true, hidden: false },
            { player: 1, type: 'ai', tribeId: 1, colorId: 9, claimable: false, hidden: true },
          ],
        },
      ]),
    ).toEqual([
      {
        id: 'bridges',
        minimap: true,
        fixedColors: true,
        players: [
          { player: 0, type: 'ai', tribeId: 1, colorId: 1, claimable: true, hidden: false },
          { player: 1, type: 'ai', tribeId: 1, colorId: 9, claimable: false, hidden: true },
        ],
      },
    ]);
  });
});

describe('roster state', () => {
  const players = [
    { player: 0, type: 'human', tribeId: 1, colorId: 7, claimable: true, hidden: false },
    { player: 1, type: 'human', tribeId: 2, colorId: 4, claimable: true, hidden: false },
    { player: 2, type: 'ai', tribeId: 4, colorId: 9, claimable: false, hidden: false },
  ] as const;

  it('gates start params on a claimed seat and encodes only deviations', () => {
    let state = initialRosterState(players);
    expect(rosterStartParams(state, players)).toEqual([]);
    state = claimSeat(state, 0);
    expect(rosterStartParams(state, players)).toEqual([['player', '0']]);
  });

  it('encodes recolours and vacant-AI seats alongside the seat', () => {
    let state = claimSeat(initialRosterState(players), 0);
    const recoloured = setSlotColor(state, 2, 3);
    expect(recoloured).not.toBeNull();
    state = toggleVacantMode(recoloured ?? state, 1);
    expect(rosterStartParams(state, players)).toEqual([
      ['player', '0'],
      ['colors', '2:3'],
      ['vacantai', '1'],
    ]);
  });

  it('rejects a colour another slot wears and accepts re-picking your own', () => {
    const state = initialRosterState(players);
    expect(setSlotColor(state, 0, 4)).toBeNull(); // slot 1 wears green
    expect(setSlotColor(state, 0, 7)).not.toBeNull(); // own colour, no-op accepted
  });

  it('claiming a seat clears its vacant-AI toggle', () => {
    let state = toggleVacantMode(initialRosterState(players), 1);
    state = claimSeat(state, 1);
    expect(rosterStartParams(state, players)).toEqual([['player', '1']]);
  });
});

describe('targetSearch', () => {
  it('carries only player-facing game settings into the selected entry', () => {
    const current = new URLSearchParams(
      'lang=eng&uiscale=1.75&speed=6&fog=recon&debug=geometry&zoom=2&sound=off&atlas=none&terrain=off&objects=off&pitch=44&pitchy=50',
    );

    expect(targetSearch('?scene=sandbox', current)).toBe(
      '?lang=eng&uiscale=1.75&speed=6&fog=recon&debug=geometry&scene=sandbox',
    );
  });

  it('offers slower and faster rates around the three in-game speeds', () => {
    expect(MENU_SPEEDS).toEqual(['0.25', '0.5', '1', '2', '3', '4', '6', '8']);
  });

  it('offers only the three player-facing fog modes', () => {
    expect(MENU_FOG_MODES).toEqual(['off', 'reveal', 'recon']);
  });

  it('defaults maps to classic fog when no mode was selected', () => {
    expect(targetSearch('?map=blekiny_nurt', new URLSearchParams('lang=pol'))).toBe(
      '?lang=pol&map=blekiny_nurt&fog=reveal',
    );
  });

  it('leaves a scene on its own authored fog when no mode was selected', () => {
    expect(targetSearch('?scene=sandbox', new URLSearchParams('lang=pol'))).toBe('?lang=pol&scene=sandbox');
  });

  it('does not add a fog mode to tools', () => {
    expect(targetSearch('?icons', new URLSearchParams('lang=pol'))).toBe('?lang=pol&icons=');
  });
});
