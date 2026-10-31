import { z } from 'zod';

/**
 * `content/gui/names/<lang>.json`: the localized personal names the pipeline writes from the `names`
 * translation overlays, keyed by pool id and then by the raw spelling the pool gives a settler. A pool
 * with nothing translated is absent, and a name it lacks keeps the raw one, so the file may hold any
 * part of the pools.
 */
export const PersonalNamesFile = z.record(z.string().min(1), z.record(z.string().min(1), z.string().min(1)));
export type PersonalNamesFile = z.infer<typeof PersonalNamesFile>;
