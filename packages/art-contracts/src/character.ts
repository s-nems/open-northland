import { z } from 'zod';

export const ownCharacterShadow = z
  .object({
    sprite: z.literal('shadow.png'),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    cellWidth: z.number().int().positive(),
    cellHeight: z.number().int().positive(),
    columns: z.number().int().positive(),
    anchorX: z.number().finite(),
    anchorY: z.number().finite(),
  })
  .strict();

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
    shadow: ownCharacterShadow.optional(),
    smoothMotion: z.boolean().optional(),
    filtering: z.enum(['nearest', 'linear']).optional(),
    walkFrames: z.number().int().positive(),
    idleFrames: z.number().int().positive(),
    idleDuration: z.number().positive(),
    idleFrameDurations: z.array(z.number().positive()).optional(),
    idleFrameOrder: z.array(z.number().int().nonnegative()).min(1).optional(),
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
    const count =
      8 * (m.walkFrames + m.idleFrames + (m.atomicClips ?? []).reduce((sum, clip) => sum + clip.frames, 0));
    if (m.columns * m.cellWidth !== m.width || Math.ceil(count / m.columns) * m.cellHeight !== m.height)
      ctx.addIssue({ code: 'custom', message: 'Character clip coverage disagrees with atlas' });
    if (m.anchorX < 0 || m.anchorX > m.cellWidth || m.anchorY < 0 || m.anchorY > m.cellHeight)
      ctx.addIssue({ code: 'custom', message: 'Character anchor outside cell' });
    if (m.shadow) {
      const s = m.shadow;
      if (s.columns * s.cellWidth !== s.width || Math.ceil(count / s.columns) * s.cellHeight !== s.height)
        ctx.addIssue({
          code: 'custom',
          path: ['shadow'],
          message: 'Shadow coverage disagrees with character clips',
        });
      if (s.anchorX < 0 || s.anchorX > s.cellWidth || s.anchorY < 0 || s.anchorY > s.cellHeight)
        ctx.addIssue({ code: 'custom', path: ['shadow'], message: 'Shadow anchor outside cell' });
    }
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
    if (m.idleFrameOrder?.some((frame) => frame >= m.idleFrames))
      ctx.addIssue({
        code: 'custom',
        path: ['idleFrameOrder'],
        message: 'Idle frame index outside stored poses',
      });
    if (m.idleFrameOrder && !m.idleFrameDurations)
      ctx.addIssue({
        code: 'custom',
        path: ['idleFrameDurations'],
        message: 'Ordered idle requires explicit step durations',
      });
    if (m.idleFrameDurations === undefined) return;
    const total = m.idleFrameDurations.reduce((sum, duration) => sum + duration, 0);
    if (
      m.idleFrameDurations.length !== (m.idleFrameOrder?.length ?? m.idleFrames) ||
      Math.abs(total - m.idleDuration) > 0.000001
    )
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
