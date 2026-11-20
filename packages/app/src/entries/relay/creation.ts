import { mapLobbySlots } from '@open-northland/data';
import { MAX_ROOM_NAME_LENGTH, type RoomSeatSetup, type RoomSettings } from '@open-northland/net-protocol';
import { loadMapMeta, loadMapScript } from '../../content/map/loader.js';
import { mapFetch } from '../../content/map-source/index.js';
import { assertMultiplayerMap } from '../../game/map/multiplayer.js';
import { sessionRuleOverrides, withMapOreYield } from '../../game/match/session-rules.js';
import { DEFAULT_SESSION_SPEED, drawSessionSeed, seedParam } from '../../game/match/session-url.js';
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
 *  the map allows it and every other seat open, and the search's seed, rules and tempo, the ore
 *  richness defaulting to the map's own. */
export async function roomCreation(params: URLSearchParams, mapId: string): Promise<RoomCreation> {
  const files = await mapFetch(mapId);
  const [script, meta] = await Promise.all([loadMapScript(mapId, files), loadMapMeta(mapId, files)]);
  assertMultiplayerMap(script);
  return {
    settings: {
      name: mapId.slice(0, MAX_ROOM_NAME_LENGTH),
      world: { kind: 'map', mapId },
      seed: seedParam(params) ?? drawSessionSeed(),
      rules: withMapOreYield(sessionRuleOverrides(params), meta?.roomDefaults),
      speed: floatParam(params, 'speed', DEFAULT_SESSION_SPEED),
    },
    seats: (script === null ? [] : mapLobbySlots(script)).map((slot) => ({
      player: slot.player,
      mode: authoredVacantMode(slot),
      offers: vacantOffers(slot),
      claimable: slot.claimable && !slot.hidden,
      color: slot.colorId,
      authoredTribe: slot.tribeId,
      ...(offersDifficulty(slot) ? { difficulty: startingDifficulty(slot) } : {}),
    })),
  };
}
