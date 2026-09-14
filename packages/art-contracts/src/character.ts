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

const storedClip = z.object({
  frames: z.number().int().positive(),
  duration: z.number().positive(),
  frameDurations: z.array(z.number().positive()).optional(),
  frameOrder: z.array(z.number().int().nonnegative()).min(1).optional(),
});
export type OwnStoredClip = z.infer<typeof storedClip>;
/** A good's content slug (`wood`, `food_simple`), the key a carry clip binds through. */
export const goodSlug = z.string().regex(/^[a-z0-9_]+$/);

/** Atlas cells in layout order: walk, idle, atomic clips, carry clips, each eight facings wide. */
export function ownCharacterFrameCount(m: {
  readonly walkFrames: number;
  readonly idleFrames: number;
  readonly atomicClips?: readonly { readonly frames: number }[] | undefined;
  readonly carryClips?: readonly { readonly frames: number }[] | undefined;
}): number {
  const clips = [...(m.atomicClips ?? []), ...(m.carryClips ?? [])];
  return 8 * (m.walkFrames + m.idleFrames + clips.reduce((sum, clip) => sum + clip.frames, 0));
}

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
    walkFrameDurations: z.array(z.number().positive()).optional(),
    walkFrameOrder: z.array(z.number().int().nonnegative()).min(1).optional(),
    walkTravelPerCycle: z.array(z.number().positive()).length(8).optional(),
    atomicClips: z.array(storedClip.extend({ atomicId: z.number().int().nonnegative() }).strict()).optional(),
    /** Loaded walks, stored at the walk's frame count and duration so they share its gait clock. */
    carryClips: z
      .array(
        z
          .object({ good: goodSlug, frames: z.number().int().positive(), duration: z.number().positive() })
          .strict(),
      )
      .optional(),
    sourceBasis: z.string().min(1),
  })
  .strict()
  .superRefine((m, ctx) => {
    const count = ownCharacterFrameCount(m);
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
    function playback(
      frames: number,
      duration: number,
      order: number[] | undefined,
      holds: number[] | undefined,
      orderPath: (string | number)[],
      holdPath: (string | number)[],
    ) {
      if (order?.some((frame) => frame >= frames))
        ctx.addIssue({ code: 'custom', path: orderPath, message: 'Playback index outside stored poses' });
      if (order && !holds)
        ctx.addIssue({
          code: 'custom',
          path: holdPath,
          message: 'Frame order requires explicit step durations',
        });
      if (
        holds &&
        (holds.length !== (order?.length ?? frames) ||
          Math.abs(holds.reduce((sum, hold) => sum + hold, 0) - duration) > 0.000001)
      )
        ctx.addIssue({
          code: 'custom',
          path: holdPath,
          message: 'Pose holds must cover playback steps and sum to duration',
        });
    }
    playback(
      m.walkFrames,
      m.walkDuration,
      m.walkFrameOrder,
      m.walkFrameDurations,
      ['walkFrameOrder'],
      ['walkFrameDurations'],
    );
    playback(
      m.idleFrames,
      m.idleDuration,
      m.idleFrameOrder,
      m.idleFrameDurations,
      ['idleFrameOrder'],
      ['idleFrameDurations'],
    );
    const seen = new Set<number>();
    for (const [index, clip] of (m.atomicClips ?? []).entries()) {
      if (seen.has(clip.atomicId))
        ctx.addIssue({
          code: 'custom',
          path: ['atomicClips', index, 'atomicId'],
          message: 'Duplicate atomic clip',
        });
      seen.add(clip.atomicId);
      playback(
        clip.frames,
        clip.duration,
        clip.frameOrder,
        clip.frameDurations,
        ['atomicClips', index, 'frameOrder'],
        ['atomicClips', index, 'frameDurations'],
      );
    }
    const goods = new Set<string>();
    for (const [index, clip] of (m.carryClips ?? []).entries()) {
      if (goods.has(clip.good))
        ctx.addIssue({
          code: 'custom',
          path: ['carryClips', index, 'good'],
          message: 'Duplicate carry clip',
        });
      goods.add(clip.good);
      if (clip.frames !== m.walkFrames || clip.duration !== m.walkDuration)
        ctx.addIssue({
          code: 'custom',
          path: ['carryClips', index],
          message: 'Carry clip must match the walk',
        });
    }
  });
export type OwnCharacterManifest = z.infer<typeof ownCharacterManifest>;

const appearanceId = z.string().regex(/^[a-z0-9-]+$/);
export const ownCharacterSelection = z
  .array(appearanceId)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate selected appearance');
export const ownCharacterJobSelection = z.record(z.string().min(1), appearanceId);
