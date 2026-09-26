import { createSavedSessionMetadata } from '@open-northland/lockstep';
import type { RelayClientView } from '@open-northland/net-client';
import type { SaveLoadSessionOptions } from '../view/runtime/save-load/index.js';

/** The save hooks of a relayed session, alive while the client runs the world numbered `worldId`. */
export function networkSaveSession(
  client: Pick<RelayClientView, 'worldId' | 'session' | 'room' | 'speed' | 'shareSave'>,
  worldId: number,
): Pick<SaveLoadSessionOptions, 'sessionMetadata' | 'onSaved'> {
  return {
    sessionMetadata() {
      const { session, room } = client;
      if (client.worldId !== worldId || session === null || room === null)
        throw new Error('The multiplayer world is no longer active');
      return createSavedSessionMetadata(
        { ...session, speed: client.speed, seats: room.seats },
        room.seats.map(({ player, nick }) => ({ player, nick })),
      );
    },
    async onSaved(save) {
      if (client.worldId === worldId) await client.shareSave(null, save);
    },
  };
}
