import { z } from 'zod';
import { MapProvenance } from './provenance.js';

/** A map's metadata sidecar: optional strings and music, and the provenance the pipeline always
 *  writes (a hand-edited sidecar without it counts as unknown). Not strict, so a newer sidecar with
 *  an extra field still loads. */
export const MapMeta = z.object({
  provenance: MapProvenance.optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  /** `DM_MUSIC_TYPE_*` (0-38). */
  musicType: z.number().int().optional(),
});
export type MapMeta = z.infer<typeof MapMeta>;
