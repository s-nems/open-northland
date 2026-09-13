import { z } from 'zod';
import { Provenance } from '../record.js';
import { MapProvenance } from './provenance.js';

/**
 * The decoded logic header of one `map.cif`: the declarative scalars at the top of its `CStringArray`
 * (`logiccontrol` plus the `misc_*` sections). Identity and metadata only. The terrain grid and the
 * scripting payload are separate per-map artifacts, and `AIData` stays unextracted.
 */
export const MapInfo = z.strictObject({
  provenance: MapProvenance.optional(),
  /** Stable slug id (the map folder name, lower-cased), the cross-reference key. */
  id: z.string(),
  /** Map width in cells (`logiccontrol` `mapsize <w> <h>`, first value). */
  width: z.number().int().positive(),
  /** Map height in cells (`logiccontrol` `mapsize <w> <h>`, second value). */
  height: z.number().int().positive(),
  /** The 16-byte map GUID (`logiccontrol` `mapguid`), as raw bytes 0..255 in file order. */
  guid: z.array(z.number().int().min(0).max(255)).length(16),
  /** Map kind (`misc_maptype` `maptype`): observed 1 = single-player/campaign, 4 = skirmish/multiplayer. */
  mapType: z.number().int().nonnegative().optional(),
  /** Campaign + mission slot (`misc_maptype` `mapcampaignid <campaign> <mission>`), present only on campaign maps. */
  campaign: z.strictObject({ campaignId: z.number().int(), missionId: z.number().int() }).optional(),
  /** String-table id of the map's display name (`misc_mapname` `mapnamestringid`). */
  nameStringId: z.number().int().optional(),
  /** String-table id of the map's description (`misc_mapname` `mapdescriptionstringid`). */
  descriptionStringId: z.number().int().optional(),
  source: Provenance.optional(),
});
export type MapInfo = z.infer<typeof MapInfo>;
