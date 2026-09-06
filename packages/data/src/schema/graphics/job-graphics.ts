import { z } from 'zod';
import { Provenance, TypeId } from '../record.js';

/**
 * One `[jobbasegraphics]` record from `humans/jobgraphics.ini`: the body bob set and the head bob sets
 * a `(logictribe, logicjob)` human composes, plus the palettes that colour them. The same job recurs
 * per tribe with a different body, so consumers key on the pair.
 */
export const JobGraphics = z.strictObject({
  /** `logictribe` - the `logicdefines.inc` `TRIBE_TYPE_*` id (viking 1, frank 2). */
  tribe: TypeId,
  /** `logicjob` - the `jobtypes.ini` type this look draws. */
  job: TypeId,
  /** `gfxbobmanagerbody` slot 0 - the body bob set, normalized to lower-case with forward slashes. */
  body: z.string(),
  /** The body's shadow bob set, when the record names one. */
  shadowBody: z.string().optional(),
  /** `gfxbobmanagerhead` slots in file order: the head looks a settler picks among. Empty for a
   *  body-only look whose head is baked into the body bob. */
  heads: z.array(z.string()).default([]),
  /** `gfxpalettebasebody` editname, lower-cased. */
  bodyPalette: z.string().optional(),
  /** `gfxpalettebasehead` editname, lower-cased. */
  headPalette: z.string().optional(),
  source: Provenance.optional(),
});
export type JobGraphics = z.infer<typeof JobGraphics>;
