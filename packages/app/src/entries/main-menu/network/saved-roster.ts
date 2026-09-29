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
  const byPlayer = new Map(authored.map((seat) => [seat.player, seat]));
  return seats.map(({ player, color, team, mode, tribe }) => {
    const vacant = mode === 'human' ? 'idle' : mode;
    const map = byPlayer.get(player);
    const offered = map?.offers ?? [];
    return {
      player,
      color,
      ...(team === undefined ? {} : { team }),
      mode: vacant,
      // A seat the save left off the map keeps saying so; the room refuses a new `absent` either way.
      offers: offered.includes(vacant) ? offered : [...offered, vacant],
      // The saved world already plays its tribes, so the room starts from them and keeps them.
      ...(map?.authoredTribe === undefined ? {} : { authoredTribe: map.authoredTribe }),
      ...(map?.authoredTribe === undefined || tribe === undefined ? {} : { tribe }),
    };
  });
}
