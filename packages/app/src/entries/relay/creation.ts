import { MAX_ROOM_NAME_LENGTH, type RoomSeatSetup, type RoomSettings } from '@open-northland/net-protocol';
import { loadMapScript } from '../../content/map-loader.js';
import { assertMultiplayerMap } from '../../game/multiplayer-map.js';
import { sessionRuleOverrides } from '../../game/session-rules.js';
import { DEFAULT_SESSION_SEED, DEFAULT_SESSION_SPEED } from '../../game/session-url.js';
import { floatParam, intParam } from '../../view/params.js';

interface RoomCreation {
  readonly settings: RoomSettings;
  readonly seats: readonly RoomSeatSetup[];
}

/** The room a creator opens for a map: its script's roster, with the authored AI seats kept as AI and
 *  every other seat open, and the search's seed, rules and tempo. */
export async function roomCreation(params: URLSearchParams, mapId: string): Promise<RoomCreation> {
  const script = await loadMapScript(mapId);
  assertMultiplayerMap(script);
  return {
    settings: {
      name: mapId.slice(0, MAX_ROOM_NAME_LENGTH),
      world: { kind: 'map', mapId },
      seed: intParam(params, 'seed', DEFAULT_SESSION_SEED),
      rules: sessionRuleOverrides(params),
      speed: floatParam(params, 'speed', DEFAULT_SESSION_SPEED),
    },
    seats: (script?.players ?? []).map((slot) => ({
      player: slot.player,
      mode: slot.type === 'ai' ? 'ai' : 'idle',
      color: slot.colorId,
    })),
  };
}
