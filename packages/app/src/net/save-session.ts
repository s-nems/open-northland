import { createSavedSessionMetadata } from '@open-northland/lockstep';
import type { RelayClient } from '@open-northland/net-client';
import type { Simulation } from '@open-northland/sim';
import type { SaveLoadSessionOptions } from '../view/runtime/save-load/index.js';

export function networkSaveSession(
  client: RelayClient,
  sim: Simulation,
): Pick<SaveLoadSessionOptions, 'sessionMetadata' | 'onSaved'> {
  return {
    sessionMetadata() {
      const { session, room } = client;
      if (client.sim !== sim || session === null || room === null)
        throw new Error('The multiplayer world is no longer active');
      return createSavedSessionMetadata(
        { ...session, speed: client.speed, seats: room.seats },
        room.seats.map(({ player, nick }) => ({ player, nick })),
      );
    },
    async onSaved(save) {
      if (client.sim === sim) await client.shareSave(null, save);
    },
  };
}
