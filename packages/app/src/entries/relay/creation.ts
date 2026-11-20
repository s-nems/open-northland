import { mapLobbySlots } from '@open-northland/data';
import { MAX_ROOM_NAME_LENGTH, type RoomSeatSetup, type RoomSettings } from '@open-northland/net-protocol';
import { loadMapScript } from '../../content/map/loader.js';
import { mapFetch } from '../../content/map-source/index.js';
import { assertMultiplayerMap } from '../../game/map/multiplayer.js';
import {
  chosenMapVariantParam,
  mapSessionWorld,
  variantMapScript,
  withVariantOreYield,
} from '../../game/map/variant.js';
import { sessionRuleOverrides } from '../../game/match/session-rules.js';
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

/** The room a creator opens for a map under the variant the search chooses: its script's roster, with the
 *  authored AI seats kept as AI where the map allows it and every other seat open, and the search's
 *  seed, rules and tempo. */
export async function roomCreation(params: URLSearchParams, mapId: string): Promise<RoomCreation> {
  const world = mapSessionWorld(mapId, chosenMapVariantParam(params, mapId));
  const script = variantMapScript(await loadMapScript(mapId, await mapFetch(mapId)), world);
  assertMultiplayerMap(script);
  return {
    settings: {
      name: mapId.slice(0, MAX_ROOM_NAME_LENGTH),
      world,
      seed: seedParam(params) ?? drawSessionSeed(),
      rules: withVariantOreYield(sessionRuleOverrides(params), world),
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
