import { z } from 'zod';
import { Provenance } from '../record.js';

/**
 * The decoded logic header of one `map.cif` — the readable, declarative scalars at the top of a map's
 * `CStringArray` (`logiccontrol` + the `misc_*` sections). This is not the playable terrain: the
 * binary tile/landscape grid (if stored outside this header) is a Phase-2 cell-graph concern. What is
 * captured here is the map's identity and metadata, which every map carries consistently:
 * dimensions, a stable GUID, its type/campaign slot, and the string-table ids of its name/description.
 *
 * The map's scripting payload — `MissionData` goals/results, `StaticObjects` pre-placed houses/goods,
 * `playerdata`/`AIData` — is deliberately not extracted here: it is the campaign/trigger layer,
 * a far larger vocabulary than this metadata slice. See docs/SOURCES.md.
 */
export const MapInfo = z.strictObject({
  /** Stable slug id (from the map folder name, lower-cased) — the cross-reference key. */
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
  /** String-table id of the map's display name (`misc_mapname` `mapnamestringid`) — resolved against the locale strings, a later step. */
  nameStringId: z.number().int().optional(),
  /** String-table id of the map's description (`misc_mapname` `mapdescriptionstringid`). */
  descriptionStringId: z.number().int().optional(),
  source: Provenance.optional(),
});
export type MapInfo = z.infer<typeof MapInfo>;
