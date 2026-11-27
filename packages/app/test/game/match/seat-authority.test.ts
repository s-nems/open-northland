import { MapScript, mapLobbySlots } from '@open-northland/data';
import type { RoomSeatView } from '@open-northland/net-protocol';
import { exportSaveGame, serializeSaveGame } from '@open-northland/sim';
import { expect, it } from 'vitest';
import { buildRelayedMapWorld } from '../../../src/entries/map/world-inputs.js';
import { assertMapRoomSeats } from '../../../src/game/match/session-roster.js';
import { mapSession } from '../../../src/game/match/session-url.js';

const script = MapScript.parse({
  players: [0, 1, 2].map((player) => ({
    player,
    type: player === 0 ? 'human' : 'ai',
    tribeId: 1,
    colorId: player,
  })),
  multiplayer: { hiddenSlots: [2] },
});
const session = mapSession(new URLSearchParams('map=test&player=0&seed=1'), mapLobbySlots(script));
const boot = {
  map: null,
  ir: null,
  script,
  content: null,
  session,
  missions: null,
  saveText: null,
  replayText: null,
};

it.each([
  [0, 'map-ai'],
  [1, 'human'],
  [1, 'computer'],
  [1, 'idle'],
  [1, 'absent'],
  [2, 'human'],
] as const)('refuses forged control of map seat %i as %s before building a relayed world', (player, mode) => {
  const forged = {
    ...session,
    seats: session.seats.map((seat) => (seat.player === player ? { ...seat, mode } : seat)),
  };
  expect(() => buildRelayedMapWorld({ ...boot, session: forged }, null, null)).toThrow(
    'control restrictions',
  );
});

it('checks saved starts and reconnect snapshots against the same authored reservations', () => {
  const source = buildRelayedMapWorld(boot, null, null).sim;
  const save = exportSaveGame(source);
  const saveText = serializeSaveGame(save);
  const forged = { ...session, seats: session.seats.map((seat) => ({ ...seat, mode: 'human' as const })) };
  expect(() => buildRelayedMapWorld({ ...boot, session: forged }, save, saveText)).toThrow(
    'control restrictions',
  );
  expect(() =>
    buildRelayedMapWorld(
      {
        ...boot,
        session: { ...forged, initialSave: { tick: save.header.tick, fingerprint: 'a'.repeat(64) } },
      },
      save,
      saveText,
    ),
  ).toThrow('control restrictions');
});

it('refuses a room that offers human claims or other modes on reserved seats', () => {
  const seats: RoomSeatView[] = session.seats.map((seat) => ({
    ...seat,
    claimable: seat.player === 0,
    offers: seat.player === 0 ? ['computer', 'idle', 'absent'] : ['map-ai'],
    nick: seat.player === 0 ? 'Ania' : null,
    ready: false,
  }));
  expect(() => assertMapRoomSeats(seats, script)).not.toThrow();
  // An ordinary human may depart into Idle even when the creator narrowed its vacant offers.
  expect(() =>
    assertMapRoomSeats(
      seats.map((seat) =>
        seat.player === 0 ? { ...seat, mode: 'idle', offers: ['computer'], nick: null } : seat,
      ),
      script,
    ),
  ).not.toThrow();
  expect(() =>
    assertMapRoomSeats(
      seats.map((seat) => ({ ...seat, claimable: true })),
      script,
    ),
  ).toThrow('claim restrictions');
  expect(() =>
    assertMapRoomSeats(
      seats.map((seat) => (seat.player === 1 ? { ...seat, offers: ['map-ai', 'idle'] } : seat)),
      script,
    ),
  ).toThrow('control restrictions');
});
