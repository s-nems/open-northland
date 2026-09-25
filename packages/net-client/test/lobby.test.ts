import { RelayClient } from '@open-northland/net-client';
import {
  type ClientMessage,
  type LobbyCompatibility,
  PROTOCOL_VERSION,
  type RoomView,
} from '@open-northland/net-protocol';
import { describe, expect, it } from 'vitest';

function harness() {
  const sent: ClientMessage[] = [];
  const client = new RelayClient({
    token: 'token-0123456789abcdef',
    nick: 'Ania',
    world: { open: async () => null, restore: async () => null },
  });
  client.attach((message) => sent.push(message));
  return { client, sent };
}

const COMPATIBILITY: LobbyCompatibility = {
  content: 'a'.repeat(64),
  map: 'b'.repeat(64),
  client: 'test-client',
  protocol: PROTOCOL_VERSION,
};
const ROOM: RoomView = {
  id: 'ab12',
  state: 'lobby',
  creator: 'Ania',
  settings: {
    name: 'Forest',
    world: { kind: 'map', mapId: 'forest' },
    seed: 7,
    rules: { fog: null, progression: null, needs: null },
    speed: 1,
  },
  seats: [
    {
      player: 0,
      mode: 'human',
      offers: ['idle', 'ai', 'absent'],
      color: 0,
      team: 2,
      nick: 'Ania',
      ready: false,
    },
  ],
  members: [{ nick: 'Ania', seat: 0, connected: true, compatibility: COMPATIBILITY }],
};

describe('RelayClient lobby API', () => {
  it('sends lobby requests without optimistically changing the authoritative room', () => {
    const { client, sent } = harness();
    client.receive({ kind: 'room', room: ROOM });
    client.listRooms();
    client.setSeat(0, { color: 3, team: 1 });
    client.setCompatibility(COMPATIBILITY);
    client.setCompatibility(null);
    const settings = { name: 'Other', seed: 8, rules: ROOM.settings.rules, speed: 2 };
    client.setSettings(settings);
    client.leaveRoom();
    expect(sent).toEqual([
      { kind: 'listRooms' },
      { kind: 'setSeat', player: 0, color: 3, team: 1 },
      { kind: 'setCompatibility', compatibility: COMPATIBILITY },
      { kind: 'setCompatibility', compatibility: null },
      { kind: 'setSettings', settings },
      { kind: 'leaveRoom' },
    ]);
    expect(client.room).toEqual(ROOM);
    client.receive({ kind: 'left' });
    expect(client.room).toBeNull();
  });

  it('retains room summaries and server-assigned names before notifying the display', () => {
    const { client } = harness();
    client.receive({ kind: 'welcome', protocol: PROTOCOL_VERSION, nick: 'Ania (2)' });
    const rooms = [{ id: 'ab12', name: 'Forest', state: 'lobby', members: 1, seats: 2 }] as const;
    client.receive({ kind: 'rooms', rooms });
    expect(client.nick).toBe('Ania (2)');
    expect(client.welcomed).toBe(true);
    expect(client.rooms).toEqual(rooms);
    client.receive({ kind: 'rooms', rooms: [] });
    expect(client.rooms).toEqual([]);
  });
});
