import { z } from 'zod';
import { ClassId, Provenance } from '../record.js';

/** `gfxframes <valency> <bobId…>`: one valency's frame list into the particle's atlas, in play order. */
export const ParticleFrames = z.strictObject({
  valency: z.number().int().nonnegative(),
  bobIds: z.array(z.number().int().nonnegative()),
});
export type ParticleFrames = z.infer<typeof ParticleFrames>;

/**
 * One `[particel]` record from `Data/engine2d/inis/particel/particel.cif`: a render-only sprite the
 * engine flies or stages (a shot in flight, its trail, dust, smoke). Positional: `spawnParticle` and
 * the engine's own references name a record by its {@link ParticleGfx.index}. A record with no
 * `bobmanager` (`snow ball`) has no art and keeps its slot.
 */
export const ParticleGfx = z.strictObject({
  /** The 0-based position in the `[particel]` list. */
  index: z.number().int().nonnegative(),
  /** `name`, as written (`"Rock"`, `"Rock Smoke"`, `"Smoke.org"`). */
  name: z.string(),
  /** `bobmanager` - the bob set, normalized. */
  bmd: z.string().optional(),
  /** `palette` - the recolour skin (lower-cased), keying the `(bmd, palette)` atlas. */
  paletteName: z.string().optional(),
  /** Per-valency frame lists (`gfxframes`), file order. */
  frames: z.array(ParticleFrames).default([]),
  /** `animloop 1` - the frame list repeats for the particle's whole life; otherwise it plays once. */
  loop: z.boolean().default(false),
  /** `valencyisdirection 1` - the valency is the heading, clockwise from screen-up over the list. */
  valencyIsDirection: z.boolean().default(false),
  /** `munitiontype` - the {@link WeaponType.munitionType} this particle draws a shot of. */
  munitionType: ClassId.optional(),
  /** `spawnparticelId` - the record index the particle leaves behind every tick of its flight. */
  spawnParticle: z.number().int().nonnegative().optional(),
  source: Provenance.optional(),
});
export type ParticleGfx = z.infer<typeof ParticleGfx>;
