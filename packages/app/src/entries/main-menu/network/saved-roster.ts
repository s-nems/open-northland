import {
  type DayNightMode,
  parseSavedSessionMetadata,
  type SessionSeat,
  type SessionWorld,
  type WeatherMode,
} from '@open-northland/lockstep';
import type { RoomSeatSetup } from '@open-northland/net-protocol';
import type { SaveGame } from '@open-northland/sim';
import { mapSessionWorld, mapVariantParam } from '../../../game/map/variant.js';
import { dayNightModeParam, weatherModeParam } from '../../../game/match/session-rules.js';
import { SAVED_COMPUTER_DIFFICULTY } from '../lobby/roster-state.js';

export function savedRoster(save: SaveGame) {
  const saved = parseSavedSessionMetadata(save.header.session);
  if (saved !== null) {
    const { world, seed } = saved.descriptor;
    if (world.kind !== 'map' || world.mapId !== save.header.mapId || seed !== save.header.seed)
      throw new Error('Saved session does not match its world');
  }
  return saved;
}

/** The map world a save was played on, its variant included: a relayed save's descriptor, else a
 *  single-player launch search. */
export function savedMapWorld(save: SaveGame, mapId: string): SessionWorld {
  const saved = savedRoster(save);
  if (saved !== null) return saved.descriptor.world;
  const entry = save.header.entry === null ? null : new URLSearchParams(save.header.entry);
  return mapSessionWorld(mapId, entry === null ? null : mapVariantParam(entry, mapId));
}

/** The weather a save was played under: a relayed save's descriptor, else a single-player launch search. */
export function savedWeatherMode(save: SaveGame): WeatherMode | null {
  const saved = savedRoster(save);
  if (saved !== null) return saved.descriptor.rules.weather;
  return save.header.entry === null ? null : weatherModeParam(new URLSearchParams(save.header.entry));
}

/** The day and night mode a save was played under, read as {@link savedWeatherMode} reads the weather. */
export function savedDayNightMode(save: SaveGame): DayNightMode | null {
  const saved = savedRoster(save);
  if (saved !== null) return saved.descriptor.rules.dayNight;
  return save.header.entry === null ? null : dayNightModeParam(new URLSearchParams(save.header.entry));
}

export function restoreSavedSeats(
  save: SaveGame,
  authored: readonly RoomSeatSetup[],
  singlePlayerSeats?: readonly SessionSeat[],
): RoomSeatSetup[] {
  const saved = savedRoster(save);
  const seats = saved?.descriptor.seats ?? singlePlayerSeats;
  if (seats === undefined) return [...authored];
  const players = new Set(authored.map((seat) => seat.player));
  if (seats.length !== players.size || seats.some((seat) => !players.has(seat.player)))
    throw new Error('Saved roster does not match its map');
  const byPlayer = new Map(authored.map((seat) => [seat.player, seat]));
  return seats.map(({ player, color, mode, tribe, difficulty }) => {
    const vacant = mode === 'human' ? 'idle' : mode;
    const map = byPlayer.get(player);
    const offered = map?.offers ?? [];
    if ((vacant === 'map-ai') !== offered.includes('map-ai'))
      throw new Error('Saved map AI seat does not match its authored reservation');
    return {
      player,
      color,
      mode: vacant,
      claimable: map?.claimable === true,
      // A seat the save left off the map keeps saying so; the room refuses a new `absent` either way.
      offers: offered.includes(vacant) ? offered : [...offered, vacant],
      // The saved world already plays its tribes, so the room starts from them and keeps them.
      ...(map?.authoredTribe === undefined ? {} : { authoredTribe: map.authoredTribe }),
      ...(map?.authoredTribe === undefined || tribe === undefined ? {} : { tribe }),
      ...(map?.difficulty === undefined ? {} : { difficulty: difficulty ?? SAVED_COMPUTER_DIFFICULTY }),
    };
  });
}
