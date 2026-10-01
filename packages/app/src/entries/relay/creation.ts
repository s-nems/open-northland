import { mapLobbySlots } from '@open-northland/data';
import { MAX_ROOM_NAME_LENGTH, type RoomSeatSetup, type RoomSettings } from '@open-northland/net-protocol';
import { loadMapScript } from '../../content/map-loader.js';
import { assertMultiplayerMap } from '../../game/multiplayer-map.js';
import { sessionRuleOverrides } from '../../game/session-rules.js';
import { DEFAULT_SESSION_SPEED, drawSessionSeed, seedParam } from '../../game/session-url.js';
import { floatParam } from '../../view/params.js';
import {
  authoredVacantMode,
  offersDifficulty,
  startingDifficulty,
  vacantOffers,
} from '../main-menu/lobby/roster-state.js';

interface RoomCreation {
  readonly settings: RoomSettings;
  readonly seats: readonly RoomSeatSetup[];
}

/** The room a creator opens for a map: its script's roster, with the authored AI seats kept as AI where
 *  the map allows it and every other seat open, and the search's seed, rules and tempo. */
export async function roomCreation(params: URLSearchParams, mapId: string): Promise<RoomCreation> {
  const script = await loadMapScript(mapId);
  assertMultiplayerMap(script);
  return {
    settings: {
      name: mapId.slice(0, MAX_ROOM_NAME_LENGTH),
      world: { kind: 'map', mapId },
      seed: seedParam(params) ?? drawSessionSeed(),
      rules: sessionRuleOverrides(params),
      speed: floatParam(params, 'speed', DEFAULT_SESSION_SPEED),
    },
    seats: (script === null ? [] : mapLobbySlots(script)).map((slot) => ({
      player: slot.player,
      mode: authoredVacantMode(slot),
      offers: vacantOffers(slot),
      color: slot.colorId,
      authoredTribe: slot.tribeId,
      ...(offersDifficulty(slot) ? { difficulty: startingDifficulty(slot) } : {}),
    })),
  };
}
