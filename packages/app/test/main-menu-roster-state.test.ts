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
} from '../src/entries/main-menu/lobby/roster-state.js';

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
    state = toggleVacantMode(state, 0); // no seat is the observer's own - slot 0 still encodes
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
    // non-claimable slot 2 stays script-driven - the strategic AI never attaches to it.
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
    // black three times) - "worn" must always be relative to the asking slot.
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
