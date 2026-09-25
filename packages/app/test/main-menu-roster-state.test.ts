import { describe, expect, it } from 'vitest';
import {
  absentSeats,
  aiSeats,
  claimSeat,
  hasClaimableSeat,
  initialRosterState,
  OBSERVER_SEAT,
  setSlotColor,
  setVacantMode,
  wornByAnother,
} from '../src/entries/main-menu/lobby/roster-state.js';

describe('roster state', () => {
  const players = [
    { player: 0, type: 'human', tribeId: 1, colorId: 7, claimable: true, hidden: false, aiAllowed: true },
    { player: 1, type: 'human', tribeId: 2, colorId: 4, claimable: true, hidden: false, aiAllowed: true },
    { player: 2, type: 'ai', tribeId: 4, colorId: 9, claimable: false, hidden: false, aiAllowed: true },
  ] as const;

  it('lists no AI seat until a slot is toggled to it', () => {
    let state = claimSeat(initialRosterState(players), 0);
    expect(aiSeats(state, players)).toEqual([]);
    state = setVacantMode(state, 1, 'ai');
    expect(aiSeats(state, players)).toEqual([1]);
  });

  it('keeps every slot eligible for the AI toggle behind a spectator seat', () => {
    let state = claimSeat(initialRosterState(players), OBSERVER_SEAT);
    state = setVacantMode(state, 0, 'ai'); // no seat is the observer's own - slot 0 still counts
    state = setVacantMode(state, 1, 'ai'); // the all-AI watch rig: every seat toggled to AI
    expect(aiSeats(state, players)).toEqual([0, 1]);
  });

  it('rejects a colour another slot wears and accepts re-picking your own', () => {
    const state = initialRosterState(players);
    expect(setSlotColor(state, 0, 4)).toBeNull(); // slot 1 wears green
    expect(setSlotColor(state, 0, 7)).not.toBeNull(); // own colour, no-op accepted
  });

  it('does not list the claimed seat as AI', () => {
    const state = claimSeat(setVacantMode(initialRosterState(players), 1, 'ai'), 1);
    expect(aiSeats(state, players)).toEqual([]);
  });

  it('defaults a claimable authored-ai slot to AI and drops it when toggled to idle', () => {
    // A lobby-opened seat (Forteca/Mosty style): authored ai, playeroption offers human. The
    // non-claimable slot 2 is the map's own computer seat, which is not the lobby's to list.
    const lobby = [
      { player: 0, type: 'human', tribeId: 1, colorId: 0, claimable: true, hidden: false, aiAllowed: true },
      { player: 1, type: 'ai', tribeId: 1, colorId: 1, claimable: true, hidden: false, aiAllowed: true },
      { player: 2, type: 'ai', tribeId: 1, colorId: 9, claimable: false, hidden: false, aiAllowed: true },
    ] as const;
    const state = claimSeat(initialRosterState(lobby), 0);
    expect(aiSeats(state, lobby)).toEqual([1]);
    expect(aiSeats(setVacantMode(state, 1, 'idle'), lobby)).toEqual([]);
  });

  it('never lists a Human/Closed-only seat as AI', () => {
    // playeroption without #PLAYER_TYPE_AI (e.g. Zgielk2 slot 0): no AI offer, so the authored
    // default is idle even on an authored-ai slot, and a toggle the UI never shows cannot leak it.
    const lobby = [
      { player: 0, type: 'human', tribeId: 1, colorId: 0, claimable: true, hidden: false, aiAllowed: true },
      { player: 1, type: 'ai', tribeId: 1, colorId: 1, claimable: true, hidden: false, aiAllowed: false },
    ] as const;
    const state = claimSeat(initialRosterState(lobby), 0);
    expect(aiSeats(state, lobby)).toEqual([]);
    expect(aiSeats(setVacantMode(state, 1, 'ai'), lobby)).toEqual([]);
  });

  it('lists an absent seat until someone sits in it, and never as AI', () => {
    let state = claimSeat(initialRosterState(players), 0);
    state = setVacantMode(state, 1, 'absent');
    expect(absentSeats(state, players)).toEqual([1]);
    expect(aiSeats(state, players)).toEqual([]);
    expect(absentSeats(claimSeat(state, 1), players)).toEqual([]);
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
