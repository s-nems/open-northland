import { describe, expect, it } from 'vitest';
import {
  claimSeat,
  hasClaimableSeat,
  initialRosterState,
  OBSERVER_SEAT,
  OVERSEER_SEAT,
  rosterStartParams,
  setSlotColor,
  toggleVacantMode,
  wornByAnother,
} from '../src/entries/menu/players/index.js';
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

describe('roster state', () => {
  const players = [
    { player: 0, type: 'human', tribeId: 1, colorId: 7, claimable: true, hidden: false, aiAllowed: true },
    { player: 1, type: 'human', tribeId: 2, colorId: 4, claimable: true, hidden: false, aiAllowed: true },
    { player: 2, type: 'ai', tribeId: 4, colorId: 9, claimable: false, hidden: false, aiAllowed: true },
  ] as const;

  it('gates start params on a claimed seat and encodes only deviations', () => {
    let state = initialRosterState(players);
    expect(rosterStartParams(state, players)).toEqual([]);
    state = claimSeat(state, 0);
    expect(rosterStartParams(state, players)).toEqual([['player', '0']]);
  });

  it('encodes the observer pseudo-seat and keeps every slot eligible for the AI toggle', () => {
    let state = claimSeat(initialRosterState(players), OBSERVER_SEAT);
    expect(rosterStartParams(state, players)).toEqual([['player', 'observer']]);
    state = toggleVacantMode(state, 0); // no seat is the observer's own — slot 0 still encodes
    state = toggleVacantMode(state, 1); // the all-AI watch rig: every seat toggled to AI
    expect(rosterStartParams(state, players)).toEqual([
      ['player', 'observer'],
      ['ai', '0,1'],
    ]);
  });

  it('encodes the overseer (god-mode) pseudo-seat like the observer', () => {
    const state = claimSeat(initialRosterState(players), OVERSEER_SEAT);
    expect(rosterStartParams(state, players)).toEqual([['player', 'overseer']]);
  });

  it('encodes recolours and AI-toggled seats alongside the seat', () => {
    let state = claimSeat(initialRosterState(players), 0);
    const recoloured = setSlotColor(state, 2, 3);
    expect(recoloured).not.toBeNull();
    state = toggleVacantMode(recoloured ?? state, 1);
    expect(rosterStartParams(state, players)).toEqual([
      ['player', '0'],
      ['colors', '2:3'],
      ['ai', '1'],
    ]);
  });

  it('rejects a colour another slot wears and accepts re-picking your own', () => {
    const state = initialRosterState(players);
    expect(setSlotColor(state, 0, 4)).toBeNull(); // slot 1 wears green
    expect(setSlotColor(state, 0, 7)).not.toBeNull(); // own colour, no-op accepted
  });

  it('does not list the claimed seat or idle-defaulted seats as AI', () => {
    let state = toggleVacantMode(initialRosterState(players), 1);
    state = toggleVacantMode(state, 1); // back to the authored idle default
    state = claimSeat(state, 1);
    expect(rosterStartParams(state, players)).toEqual([['player', '1']]);
  });

  it('defaults a claimable authored-ai slot to AI and drops it when toggled to idle', () => {
    // A lobby-opened seat (Forteca/Mosty style): authored ai, playeroption offers human. The
    // non-claimable slot 2 stays script-driven — the strategic AI never attaches to it.
    const lobby = [
      { player: 0, type: 'human', tribeId: 1, colorId: 0, claimable: true, hidden: false, aiAllowed: true },
      { player: 1, type: 'ai', tribeId: 1, colorId: 1, claimable: true, hidden: false, aiAllowed: true },
      { player: 2, type: 'ai', tribeId: 1, colorId: 9, claimable: false, hidden: false, aiAllowed: true },
    ] as const;
    let state = claimSeat(initialRosterState(lobby), 0);
    expect(rosterStartParams(state, lobby)).toEqual([
      ['player', '0'],
      ['ai', '1'], // the authored-ai default plays without touching the toggle
    ]);
    state = toggleVacantMode(state, 1);
    expect(rosterStartParams(state, lobby)).toEqual([['player', '0']]);
  });

  it('never lists a Human/Closed-only seat as AI', () => {
    // playeroption without #PLAYER_TYPE_AI (e.g. Zgielk2 slot 0): no AI offer, so the authored
    // default is idle even on an authored-ai slot, and its mode never reaches the start URL.
    const lobby = [
      { player: 0, type: 'human', tribeId: 1, colorId: 0, claimable: true, hidden: false, aiAllowed: true },
      { player: 1, type: 'ai', tribeId: 1, colorId: 1, claimable: true, hidden: false, aiAllowed: false },
    ] as const;
    let state = claimSeat(initialRosterState(lobby), 0);
    expect(rosterStartParams(state, lobby)).toEqual([['player', '0']]);
    state = toggleVacantMode(state, 1); // UI never offers this; the encoding must still not leak it
    expect(rosterStartParams(state, lobby)).toEqual([['player', '0']]);
  });

  it('keeps authored duplicate colours pickable for their own slot and blocks new duplicates', () => {
    // Real rosters duplicate colours freely (tutorial maps are all-blue; multiplayer_104 wears
    // black three times) — "worn" must always be relative to the asking slot.
    const dupes = [
      { player: 0, type: 'human', tribeId: 1, colorId: 0, claimable: true, hidden: false, aiAllowed: true },
      { player: 1, type: 'human', tribeId: 1, colorId: 0, claimable: true, hidden: false, aiAllowed: true },
      { player: 2, type: 'human', tribeId: 1, colorId: 4, claimable: true, hidden: false, aiAllowed: true },
    ] as const;
    const state = initialRosterState(dupes);
    expect(wornByAnother(state, 1, 0)).toBe(true); // slot 0 also wears blue…
    expect(setSlotColor(state, 1, 0)).not.toBeNull(); // …but re-picking your own blue is a no-op accept
    expect(setSlotColor(state, 2, 0)).toBeNull(); // a third slot cannot newly join the duplicate
    expect(setSlotColor(state, 1, 3)).not.toBeNull(); // moving off the duplicate is free
  });

  it('does not gate Start when a roster offers no claimable seat', () => {
    const allAi = [
      { player: 0, type: 'ai', tribeId: 1, colorId: 0, claimable: false, hidden: false, aiAllowed: true },
    ] as const;
    expect(hasClaimableSeat(allAi)).toBe(false);
    expect(hasClaimableSeat([{ ...allAi[0], claimable: true, hidden: true }])).toBe(false);
    expect(hasClaimableSeat([{ ...allAi[0], claimable: true }])).toBe(true);
  });
});

describe('targetSearch', () => {
  it('carries only player-facing game settings into the selected entry', () => {
    const current = new URLSearchParams(
      'lang=eng&uiscale=1.75&speed=6&fog=recon&debug=geometry&zoom=2&sound=off&atlas=none&terrain=off&objects=off&nosuchparam=1',
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
