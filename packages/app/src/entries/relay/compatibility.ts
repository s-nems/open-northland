import type { RelayClient } from '@open-northland/net-client';
import { type LobbyCompatibility, type RoomView, sameCompatibility } from '@open-northland/net-protocol';
import { loadLobbyCompatibility } from '../../content/lobby-identity.js';

type Client = Pick<RelayClient, 'room' | 'nick' | 'setCompatibility'>;

export function lobbyCompatibilityReporter(
  client: Client,
  failed: (error: unknown) => void,
  load: (mapId: string) => Promise<LobbyCompatibility> = loadLobbyCompatibility,
) {
  let activeRoom: string | null = null;
  let generation = 0;
  let pending = false;
  let cached: LobbyCompatibility | null = null;
  let disposed = false;

  const report = (room: RoomView): void => {
    const member = room.members.find((member) => member.nick === client.nick);
    if (member !== undefined && cached !== null && !sameCompatibility(member.compatibility, cached)) {
      client.setCompatibility(cached);
    }
  };

  return {
    observe(room: RoomView): void {
      if (disposed || room.state !== 'lobby') return;
      if (room.settings.world.kind !== 'map') {
        failed(new Error('The lobby requires a decoded map'));
        return;
      }
      if (activeRoom !== room.id) {
        activeRoom = room.id;
        generation++;
        pending = false;
        cached = null;
      }
      if (cached !== null) {
        report(room);
        return;
      }
      if (pending) return;
      pending = true;
      const current = generation;
      void load(room.settings.world.mapId)
        .then((compatibility) => {
          if (disposed || current !== generation) return;
          cached = compatibility;
          const latest = client.room;
          if (latest?.id === room.id && latest.state === 'lobby') report(latest);
        })
        .catch((error: unknown) => {
          if (!disposed && current === generation) failed(error);
        })
        .finally(() => {
          if (current === generation) pending = false;
        });
    },
    dispose(): void {
      disposed = true;
      generation++;
    },
  };
}
