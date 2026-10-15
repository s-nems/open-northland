import { type MapMeta, type MapScript, type MapsIndexEntry, mapLobbySlots } from '@open-northland/data';

/** What a `maps-index.json` row is built from. */
export interface MapsIndexSource {
  readonly id: string;
  /** The `mapDocumentsFingerprint` of the terrain and script documents as served. */
  readonly fingerprint: string;
  readonly meta: MapMeta;
  readonly script?: MapScript;
  /** Whether the authored picture `maps/<id>.png` exists. */
  readonly picture: boolean;
  /** Whether the rasterized minimap `maps/<id>.map.png` exists. */
  readonly minimap: boolean;
  /** The suffixes of the briefing voices written as `maps/<id><suffix>`. */
  readonly voices: readonly string[];
}

/** One map's `maps-index.json` row, the menu's view of it without loading the map. */
export function mapsIndexEntry(map: MapsIndexSource): MapsIndexEntry {
  const { provenance, campaign, name, description, mapTypes, multiplayerOnly } = map.meta;
  const players = map.script === undefined ? [] : mapLobbySlots(map.script);
  return {
    id: map.id,
    fingerprint: map.fingerprint,
    ...(provenance === undefined ? {} : { provenance }),
    ...(campaign === undefined ? {} : { campaign }),
    ...(name === undefined ? {} : { name }),
    ...(description === undefined ? {} : { description }),
    picture: map.picture,
    minimap: map.minimap,
    ...(map.voices.length > 0 ? { voices: [...map.voices] } : {}),
    ...(players.length > 0 ? { players } : {}),
    ...(map.script?.multiplayer?.fixedColors === true ? { fixedColors: true } : {}),
    ...(mapTypes === undefined ? {} : { mapTypes }),
    ...(multiplayerOnly === true ? { multiplayerOnly: true } : {}),
  };
}
