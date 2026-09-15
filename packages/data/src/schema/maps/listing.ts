import { z } from 'zod';
import { MapMeta } from './meta.js';
import { MapProvenance } from './provenance.js';
import { MapPlayerSlot } from './script.js';

/** One lobby seat as `maps-index.json` lists it: the authored roster row plus what the map's
 *  `[multiplayer]` table says about that seat. */
export const MapsIndexPlayerSlot = MapPlayerSlot.extend({
  /** A person may take the seat: authored `human`, or its `playeroption` row offers `human`. */
  claimable: z.boolean(),
  /** `playerhideinmenu`: the lobby never lists the seat. */
  hidden: z.boolean(),
  /** The seat may auto-play when vacant: its `playeroption` row offers `ai`, or the map ships no
   *  row for it (a row can only deny `ai`). */
  aiAllowed: z.boolean(),
});
export type MapsIndexPlayerSlot = z.infer<typeof MapsIndexPlayerSlot>;

/** One `maps-index.json` entry: a decoded map's id joined with its menu sidecars. */
export const MapsIndexEntry = z.strictObject({
  id: z.string().min(1),
  provenance: MapProvenance.optional(),
  campaign: MapMeta.shape.campaign,
  name: z.string().optional(),
  description: z.string().optional(),
  /** Whether the minimap thumbnail `maps/<id>.png` exists. */
  minimap: z.boolean(),
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
