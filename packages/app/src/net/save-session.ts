import { createSavedSessionMetadata } from '@open-northland/lockstep';
import type { OpenedWorld, RelayClient } from '@open-northland/net-client';
import type { SaveLoadSessionOptions } from '../view/runtime/save-load/index.js';

/** The save hooks of a relayed session, alive while `world` is the world the client runs. */
export function networkSaveSession(
  client: RelayClient,
  world: Pick<OpenedWorld, 'sim'>,
): Pick<SaveLoadSessionOptions, 'sessionMetadata' | 'onSaved'> {
  return {
    sessionMetadata() {
      const { session, room } = client;
      if (client.sim !== world.sim || session === null || room === null)
        throw new Error('The multiplayer world is no longer active');
      return createSavedSessionMetadata(
        { ...session, speed: client.speed, seats: room.seats },
        room.seats.map(({ player, nick }) => ({ player, nick })),
      );
    },
    async onSaved(save) {
      if (client.sim === world.sim) await client.shareSave(null, save);
    },
  };
}
