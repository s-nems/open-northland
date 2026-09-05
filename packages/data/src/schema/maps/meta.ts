import { z } from 'zod';

/** A map's `maps/<id>.meta.json` sidecar: the menu-facing strings and the `[misc_music]` code, each
 *  absent when the map ships none. Not strict, so a newer sidecar with an extra field still loads. */
export const MapMeta = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  /** `DM_MUSIC_TYPE_*` (0-38). */
  musicType: z.number().int().optional(),
});
export type MapMeta = z.infer<typeof MapMeta>;
