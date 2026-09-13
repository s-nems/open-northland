import { createSavedSessionMetadata } from '@open-northland/lockstep';
import { type LobbyCompatibility, PROTOCOL_VERSION, type RoomView } from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';
import {
  canClaimSeat,
  roomPermissions,
  savedSeatHint,
} from '../../src/entries/main-menu/network/room/model.js';

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
      { player: 0, mode: 'human', color: 0, nick: 'Ania', ready: true },
      { player: 1, mode: 'human', color: 1, nick: 'Bartek', ready: true },
      { player: 2, mode: 'ai', color: 2, nick: null, ready: false },
    ],
    members: [
      { nick: 'Ania', seat: 0, connected: true, compatibility: report },
      { nick: 'Bartek', seat: 1, connected: true, compatibility: report },
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
