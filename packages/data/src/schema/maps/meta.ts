import { z } from 'zod';
import { MapProvenance } from './provenance.js';

/** `CLEAN_MAP_TYPE_*` codes of a `[misc_maptype]` `maptype` line (`logicdefines.inc`). */
export const MAP_TYPE = {
  SINGLE_PLAYER_CAMPAIGN: 1,
  SINGLE_PLAYER_FREE: 2,
  SINGLE_PLAYER_DEMO: 3,
  MULTI_PLAYER_FREE: 4,
  USER_SINGLE_PLAYER_FREE: 5,
  USER_MULTI_PLAYER_FREE: 6,
} as const;
/** `CLEAN_MAP_TYPE_MAXIMUM`: the first code a `maptype` line may not carry. */
export const MAP_TYPE_LIMIT = 7;

/** A map's metadata sidecar: optional strings, music and menu listing, and the provenance the
 *  pipeline always writes (a hand-edited sidecar without it counts as unknown). Not strict, so a
 *  newer sidecar with an extra field still loads. */
export const MapMeta = z.object({
  provenance: MapProvenance.optional(),
  campaign: z.object({ campaignId: z.number().int(), missionId: z.number().int() }).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  /** `DM_MUSIC_TYPE_*` (0-38). */
  musicType: z.number().int().optional(),
  /** The distinct `maptype` codes in file order; absent when the header declares no valid one. */
  mapTypes: z
    .array(
      z
        .number()
        .int()
        .min(1)
        .max(MAP_TYPE_LIMIT - 1),
    )
    .optional(),
  /** `[misc_maptype]` `mapmultiplayeronly`: a multiplayer map kept out of the single-player list. */
  multiplayerOnly: z.boolean().optional(),
});
export type MapMeta = z.infer<typeof MapMeta>;
