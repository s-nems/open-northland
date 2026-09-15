import { z } from 'zod';

/** One `bobs-index.json` entry: a viewable atlas, the `bobs/<stem>.png` + `bobs/<stem>.atlas.json` pair. */
export const BobsIndexEntry = z.strictObject({
  stem: z.string().min(1),
  /** The base sprite set: the stem up to the first dot, e.g. `ls_houses_viking`. */
  base: z.string().min(1),
  /** The palette variant: the stem after the first dot, or `''` when it has none. */
  variant: z.string(),
});
export type BobsIndexEntry = z.infer<typeof BobsIndexEntry>;

/** The whole `bobs-index.json`, sorted by (base, variant). */
export const BobsIndex = z.array(BobsIndexEntry);
export type BobsIndex = z.infer<typeof BobsIndex>;
