import { z } from 'zod';
import { BRIEFING_VOICE_SUFFIX } from './briefing.js';
import { MapMeta } from './meta.js';
import { MapProvenance } from './provenance.js';
import { MapPlayerSlot } from './script.js';

/** One lobby seat as `maps-index.json` lists it: the authored roster row plus what the map's
 *  `[multiplayer]` table says about that seat. */
export const MapsIndexPlayerSlot = MapPlayerSlot.extend({
  /** A person may take the seat: its `playeroption` row offers `human`, or the authored type is
   *  `human` when no options are present. A closed authored seat cannot be claimed. */
  claimable: z.boolean(),
  /** `playerhideinmenu`: the lobby never lists the seat. */
  hidden: z.boolean(),
  /** The seat may auto-play when vacant: its `playeroption` row offers `ai`, or the map ships no
   *  row for it (a row can only deny `ai`). */
  aiAllowed: z.boolean(),
  /** The seat may sit out off the map: its `playeroption` row offers `none`, or the map ships no row
   *  for it. A map without a `[multiplayer]` table allowing it is an approximation. */
  noneAllowed: z.boolean(),
  /** The authored control switches allow at least one autonomous computer-player capability. */
  hasComputerControl: z.boolean(),
});
export type MapsIndexPlayerSlot = z.infer<typeof MapsIndexPlayerSlot>;

/** A hex SHA-256, the `mapDocumentsFingerprint` of a map's terrain and script documents. */
export const MAP_FINGERPRINT = /^[a-f0-9]{64}$/;

/** One `maps-index.json` entry: a decoded map's id joined with its menu sidecars. */
export const MapsIndexEntry = z.strictObject({
  id: z.string().min(1),
  provenance: MapProvenance.optional(),
  /** The map's `mapDocumentsFingerprint`: equal for two copies of one map under different ids. */
  fingerprint: z.string().regex(MAP_FINGERPRINT),
  campaign: MapMeta.shape.campaign,
  name: MapMeta.shape.name,
  description: MapMeta.shape.description,
  /** Whether the authored picture `maps/<id>.png` exists. */
  picture: z.boolean(),
  /** Whether the terrain minimap `maps/<id>.map.png` exists. */
  minimap: z.boolean(),
  /** The `briefingVoiceSuffix` of each spoken briefing line the map ships as `maps/<id><suffix>`.
   *  Absent when it ships none, as most maps whose pages name a clip do. */
  voices: z.array(z.string().regex(BRIEFING_VOICE_SUFFIX)).optional(),
  /** Absent when the map ships no decodable roster. */
  players: z.array(MapsIndexPlayerSlot).optional(),
  /** `[multiplayer]` `playerfixcolors`: the map locks its authored team colours. Present only when true. */
  fixedColors: z.literal(true).optional(),
  mapTypes: MapMeta.shape.mapTypes,
  /** `[misc_maptype]` `mapmultiplayeronly`. Present only when true. */
  multiplayerOnly: z.literal(true).optional(),
});
export type MapsIndexEntry = z.infer<typeof MapsIndexEntry>;

/** The whole `maps-index.json`: one entry per decoded map, sorted by id. */
export const MapsIndex = z.array(MapsIndexEntry);
export type MapsIndex = z.infer<typeof MapsIndex>;
