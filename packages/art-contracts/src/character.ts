import { z } from 'zod';

export const ownCharacterManifest = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    cellWidth: z.number().int().positive(),
    cellHeight: z.number().int().positive(),
    columns: z.number().int().positive(),
    anchorX: z.number().finite(),
    anchorY: z.number().finite(),
    scale: z.number().positive(),
    smoothMotion: z.boolean().optional(),
    filtering: z.enum(['nearest', 'linear']).optional(),
    walkFrames: z.number().int().positive(),
    idleFrames: z.number().int().positive(),
    idleDuration: z.number().positive(),
    idleFrameDurations: z.array(z.number().positive()).optional(),
    walkDuration: z.number().positive(),
    walkTravelPerCycle: z.array(z.number().positive()).length(8).optional(),
    atomicClips: z
      .array(
        z
          .object({
            atomicId: z.number().int().nonnegative(),
            frames: z.number().int().positive(),
            duration: z.number().positive(),
            frameDurations: z.array(z.number().positive()).optional(),
          })
          .strict(),
      )
      .optional(),
    sourceBasis: z.string().min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    const seen = new Set<number>();
    for (const [index, clip] of (m.atomicClips ?? []).entries()) {
      if (seen.has(clip.atomicId))
        ctx.addIssue({
          code: 'custom',
          path: ['atomicClips', index, 'atomicId'],
          message: 'Duplicate atomic clip',
        });
      seen.add(clip.atomicId);
      if (
        clip.frameDurations !== undefined &&
        (clip.frameDurations.length !== clip.frames ||
          Math.abs(clip.frameDurations.reduce((sum, hold) => sum + hold, 0) - clip.duration) > 0.000001)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['atomicClips', index, 'frameDurations'],
          message: 'Pose holds must cover the atomic clip and sum to its duration',
        });
    }
    if (m.idleFrameDurations === undefined) return;
    const total = m.idleFrameDurations.reduce((sum, duration) => sum + duration, 0);
    if (m.idleFrameDurations.length !== m.idleFrames || Math.abs(total - m.idleDuration) > 0.000001)
      ctx.addIssue({
        code: 'custom',
        path: ['idleFrameDurations'],
        message: 'Pose holds must cover every idle frame and sum to idleDuration',
      });
  });
export type OwnCharacterManifest = z.infer<typeof ownCharacterManifest>;

const appearanceId = z.string().regex(/^[a-z0-9-]+$/);
export const ownCharacterSelection = z
  .array(appearanceId)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate selected appearance');
export const ownCharacterJobSelection = z.record(z.string().min(1), appearanceId);
