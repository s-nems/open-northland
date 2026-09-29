import { createSavedSessionMetadata } from '@open-northland/lockstep';
import {
  type LobbyCompatibility,
  PROTOCOL_VERSION,
  type RoomMemberView,
  type RoomView,
} from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  canClaimSeat,
  canSetSeatTribe,
  roomPermissions,
  savedSeatHint,
  seatCivilization,
} from '../../src/entries/main-menu/network/room/model.js';
import { memberLoadText } from '../../src/view/net/member-load.js';

const report: LobbyCompatibility = {
  content: 'a'.repeat(64),
  map: 'b'.repeat(64),
  client: 'test',
  protocol: PROTOCOL_VERSION,
};
function room(): RoomView {
  return {
    id: 'test',
    state: 'lobby',
    creator: 'Ania',
    settings: {
      name: 'Test',
      world: { kind: 'map', mapId: 'test' },
      seed: 1,
      rules: { fog: null, progression: null, needs: null },
      speed: 1,
    },
    seats: [
      { player: 0, mode: 'human', offers: ['idle', 'ai', 'absent'], color: 0, nick: 'Ania', ready: true },
      { player: 1, mode: 'human', offers: ['idle', 'ai', 'absent'], color: 1, nick: 'Bartek', ready: true },
      { player: 2, mode: 'ai', offers: ['idle', 'ai', 'absent'], color: 2, nick: null, ready: false },
    ],
    members: [
      { nick: 'Ania', seat: 0, connected: true, compatibility: report, load: null },
      { nick: 'Bartek', seat: 1, connected: true, compatibility: report, load: null },
    ],
  };
}

describe('network room permissions', () => {
  it('only lets the creator start and edit, and lets players claim vacant AI seats', () => {
    const view = room();
    expect(roomPermissions(view, 'Ania', true)).toMatchObject({
      canStart: true,
      creator: true,
      canSetupSeats: true,
    });
    expect(roomPermissions(view, 'Bartek', true)).toMatchObject({
      canStart: false,
      creator: false,
      canReady: true,
    });
    for (const seat of view.seats) expect(canClaimSeat(view, seat, 'Ania', true)).toBe(seat.nick === null);
  });

  it('blocks start for disconnected or unseated members and reports mismatching players', () => {
    const view = room();
    const changed = {
      ...view,
      members: view.members.map((member) =>
        member.nick === 'Bartek'
          ? { ...member, compatibility: { ...report, content: 'c'.repeat(64) } }
          : member,
      ),
    };
    const permissions = roomPermissions(changed, 'Ania', true);
    expect(permissions.canStart).toBe(false);
    expect(permissions.issues).toContainEqual({ nick: 'Bartek', kind: 'content', reason: 'mismatch' });
    // A player can revoke an existing ready flag even while another player's files mismatch.
    expect(permissions.canReady).toBe(true);
    for (const patch of [{ connected: false }, { seat: null }]) {
      expect(
        roomPermissions(
          {
            ...view,
            members: view.members.map((member) =>
              member.nick === 'Bartek' ? { ...member, ...patch } : member,
            ),
          },
          'Ania',
          true,
        ).canStart,
      ).toBe(false);
    }
  });

  it('disables commands after disconnect or start and preserves saved-state seat setup', () => {
    expect(roomPermissions(room(), 'Ania', false)).toMatchObject({
      interactive: false,
      canStart: false,
      canReady: false,
      creator: false,
    });
    expect(roomPermissions({ ...room(), state: 'running' }, 'Ania', true).interactive).toBe(false);
    const saved = {
      ...room(),
      settings: { ...room().settings, initialSave: { fingerprint: 'd'.repeat(64), tick: 20 } },
    };
    expect(roomPermissions(saved, 'Ania', true)).toMatchObject({ creator: true, canSetupSeats: false });
    const verified = {
      ...saved,
      members: saved.members.map((member) => ({
        ...member,
        compatibility: { ...report, save: saved.settings.initialSave.fingerprint },
      })),
    };
    expect(roomPermissions(verified, 'Ania', true)).toMatchObject({ canStart: true, issues: [] });
  });

  it('offers a member of a room past its start the way back in, and nothing else', () => {
    const running = { ...room(), state: 'running' as const };
    expect(roomPermissions(running, 'Ania', true)).toMatchObject({
      canRejoin: true,
      interactive: false,
      canReady: false,
      canStart: false,
    });
    expect(roomPermissions(running, 'Ania', false).canRejoin).toBe(false);
    expect(roomPermissions(running, 'Celina', true).canRejoin).toBe(false);
    expect(roomPermissions(room(), 'Ania', true).canRejoin).toBe(false);
  });
});

describe('network room tribes', () => {
  const VIKING = 1;
  const WEREWOLF = 6;
  const seat = (player: number) => {
    const found = room().seats.find((view) => view.player === player);
    if (found === undefined) throw new Error(`no seat ${player}`);
    return found;
  };

  it('offers a choice only on a seat the map gave a civilization', () => {
    expect(seatCivilization({ ...seat(0), authoredTribe: VIKING, tribe: VIKING })).toBe(VIKING);
    expect(seatCivilization({ ...seat(0), authoredTribe: WEREWOLF, tribe: WEREWOLF })).toBeNull();
    expect(seatCivilization(seat(0))).toBeNull();
  });

  it('lets the creator choose any seat’s tribe and a member its own, until a save or the start fixes them', () => {
    const view = room();
    for (const target of view.seats) expect(canSetSeatTribe(view, target, 'Ania', true)).toBe(true);
    expect(canSetSeatTribe(view, seat(1), 'Bartek', true)).toBe(true);
    expect(canSetSeatTribe(view, seat(0), 'Bartek', true)).toBe(false);
    expect(canSetSeatTribe(view, seat(2), 'Bartek', true)).toBe(false);
    expect(canSetSeatTribe(view, seat(1), 'Bartek', false)).toBe(false);
    expect(canSetSeatTribe({ ...view, state: 'running' }, seat(1), 'Bartek', true)).toBe(false);
    const saved = {
      ...view,
      settings: { ...view.settings, initialSave: { fingerprint: 'd'.repeat(64), tick: 20 } },
    };
    expect(canSetSeatTribe(saved, seat(0), 'Ania', true)).toBe(false);
    expect(canSetSeatTribe(saved, seat(1), 'Bartek', true)).toBe(false);
  });
});

it('recommends only an exact saved nick match and leaves unnamed/legacy seats without hints', () => {
  const metadata = createSavedSessionMetadata(
    {
      world: { kind: 'map', mapId: 'test' },
      seed: 1,
      speed: 1,
      localSeat: 0,
      rules: { fog: null, progression: null, needs: null },
      seats: [
        { player: 0, color: 0, mode: 'human' },
        { player: 1, color: 1, mode: 'ai' },
      ],
    },
    [
      { player: 0, nick: 'Ania' },
      { player: 1, nick: null },
    ],
  );
  expect(savedSeatHint(metadata, 0, 'Ania')).toEqual({ nick: 'Ania', recommended: true });
  expect(savedSeatHint(metadata, 0, 'ania')).toEqual({ nick: 'Ania', recommended: false });
  expect(savedSeatHint(metadata, 1, 'Ania')).toBeNull();
  expect(savedSeatHint(null, 0, 'Ania')).toBeNull();
});

describe('member load in the room', () => {
  it('reads nothing before the member reported a load', () => {
    expect(memberLoadText(room().members[0])).toBe('');
    expect(memberLoadText(undefined)).toBe('');
  });

  it('shows the tick cost to a tenth of a millisecond and the frames buffered', () => {
    const member: RoomMemberView = {
      nick: 'Ania',
      seat: 0,
      connected: true,
      compatibility: report,
      load: { tickMs: 12.345, buffered: 3 },
    };
    expect(memberLoadText(member)).toMatch(/^12\.3 ms\/.* 3\b/);
  });
});
