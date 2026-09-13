import { parseSavedSessionMetadata } from '@open-northland/lockstep';
import type { RoomSeatSetup } from '@open-northland/net-protocol';
import type { SaveGame } from '@open-northland/sim';

export function savedRoster(save: SaveGame) {
  const saved = parseSavedSessionMetadata(save.header.session);
  if (saved !== null) {
    const { world, seed } = saved.descriptor;
    if (world.kind !== 'map' || world.mapId !== save.header.mapId || seed !== save.header.seed)
      throw new Error('Saved session does not match its world');
  }
  return saved;
}

export function restoreSavedSeats(save: SaveGame, authored: readonly RoomSeatSetup[]): RoomSeatSetup[] {
  const saved = savedRoster(save);
  if (saved === null) return [...authored];
  const seats = saved.descriptor.seats;
  const players = new Set(authored.map((seat) => seat.player));
  if (seats.length !== players.size || seats.some((seat) => !players.has(seat.player)))
    throw new Error('Saved roster does not match its map');
  return seats.map(({ player, color, team, mode }) => ({
    player,
    color,
    ...(team === undefined ? {} : { team }),
    mode: mode === 'human' ? 'idle' : mode,
  }));
}
