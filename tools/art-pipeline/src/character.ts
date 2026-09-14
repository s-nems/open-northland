import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { goodSlug, ownCharacterManifest } from '@open-northland/art-contracts';
import sharp, { type OverlayOptions } from 'sharp';
import { z } from 'zod';
import { characterShadow } from './character-shadow.js';

const clipSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  frames: z.number().int().positive().max(16).optional(),
  duration: z.number().positive(),
  frameDurations: z.array(z.number().positive()).optional(),
  frameOrder: z.array(z.number().int().nonnegative()).min(1).optional(),
  atomicId: z.number().int().nonnegative().optional(),
  carryGood: goodSlug.optional(),
  /** The name of the stored atomic clip whose sprites this clip plays; it renders and stores none of its own. */
  poses: z.string().optional(),
});
type Clip = z.infer<typeof clipSchema>;
const characterRecipe = z
  .object({
    frames: z.number().int().positive().max(16),
    post: z.string(),
    runtimeCrop: z
      .object({
        left: z.number().int().nonnegative(),
        top: z.number().int().nonnegative(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .refine(
        (crop) =>
          crop.left + crop.width <= 192 &&
          crop.top + crop.height <= 144 &&
          crop.left <= 96 &&
          crop.left + crop.width > 96 &&
          crop.top <= 128 &&
          crop.top + crop.height > 128,
        'Crop must fit the source cell and contain the foot anchor',
      )
      .optional(),
    clips: z.array(clipSchema),
    walkCalibration: z.string().optional(),
    walkPlayback: z.string().optional(),
    render: z.object({ size: z.number().positive().optional() }).optional(),
  })
  .superRefine((recipe, ctx) => {
    const walk = recipe.clips.find((c) => c.name === 'walk');
    for (const [index, clip] of recipe.clips.entries()) {
      const bound = clip.atomicId !== undefined || clip.carryGood !== undefined;
      if (clip.poses !== undefined) {
        const source = recipe.clips.find((c) => c.name === clip.poses);
        if (
          clip.atomicId === undefined ||
          source?.atomicId === undefined ||
          source.poses !== undefined ||
          (clip.frames ?? recipe.frames) !== (source.frames ?? recipe.frames)
        )
          ctx.addIssue({
            code: 'custom',
            path: ['clips', index, 'poses'],
            message: 'Shared poses name a stored atomic clip with the same frame count',
          });
      }
      if (
        (clip.atomicId !== undefined && clip.carryGood !== undefined) ||
        (bound && /^(walk|idle)$/.test(clip.name))
      )
        ctx.addIssue({
          code: 'custom',
          path: ['clips', index],
          message: 'A clip binds either an atomic action or a hauled good, and walk and idle bind neither',
        });
      // A loaded walk runs on the walk's gait clock, so it must store the walk's poses at the walk's pace.
      if (
        clip.carryGood !== undefined &&
        (clip.frameOrder ||
          clip.frameDurations ||
          !walk ||
          (clip.frames ?? recipe.frames) !== (walk.frames ?? recipe.frames) ||
          clip.duration !== walk.duration)
      )
        ctx.addIssue({
          code: 'custom',
          path: ['clips', index],
          message: 'A carry clip stores the walk frame count and duration without holds',
        });
      if (!clip.frameOrder) continue;
      const count = clip.frames ?? recipe.frames;
      if (clip.frameOrder.some((frame) => frame >= count))
        ctx.addIssue({
          code: 'custom',
          path: ['clips', index, 'frameOrder'],
          message: 'Frame order requires indices within stored poses',
        });
      if (
        !clip.frameDurations ||
        clip.frameDurations.length !== clip.frameOrder.length ||
        Math.abs(clip.frameDurations.reduce((sum, hold) => sum + hold, 0) - clip.duration) > 1e-6
      )
        ctx.addIssue({
          code: 'custom',
          path: ['clips', index, 'frameDurations'],
          message: 'Frame order requires durations for every playback step',
        });
    }
  });
const storesPoses = (clip: Clip) => clip.poses === undefined;
export async function characterInputs(directory: string, source: string, shadowSource?: string) {
  const raw = characterRecipe.parse(JSON.parse(await readFile(resolve(directory, source), 'utf8')));
  const inputs = [resolve(directory, source)];
  for (const clip of raw.clips.filter(storesPoses))
    for (const facing of ['SW', 'W', 'NW', 'NE', 'E', 'SE', 'S', 'N'])
      inputs.push(resolve(directory, 'sprites', `${clip.name}-${facing}-88px.png`));
  if (raw.walkCalibration) {
    const calibration = resolve(directory, raw.walkCalibration);
    inputs.push(calibration, resolve(directory, 'layout.json'));
    if (!raw.walkPlayback) throw new Error('Missing walk playback');
    inputs.push(resolve(directory, raw.walkPlayback));
    const measurement = z
      .object({ source: z.string() })
      .parse(JSON.parse(await readFile(calibration, 'utf8')));
    inputs.push(resolve(dirname(calibration), measurement.source));
  }
  if (shadowSource) {
    const shadow = await characterShadow(directory, shadowSource);
    inputs.push(resolve(directory, shadowSource), ...shadow.inputs);
  }
  return inputs;
}
export async function packCharacter(
  directory: string,
  source: string,
  id: string,
  name: string,
  shadowSource?: string,
) {
  const recipe = characterRecipe.parse(JSON.parse(await readFile(resolve(directory, source), 'utf8')));
  function storedClip(c: Clip) {
    return {
      frames: c.frames ?? recipe.frames,
      duration: c.duration,
      ...(c.frameDurations ? { frameDurations: c.frameDurations } : {}),
      ...(c.frameOrder ? { frameOrder: c.frameOrder } : {}),
    };
  }
  const walk = recipe.clips.find((c) => c.name === 'walk'),
    idle = recipe.clips.find((c) => c.name === 'idle');
  if (!walk || !idle) throw new Error('Both walk and idle required');
  const atomics = recipe.clips.filter((c) => c.atomicId !== undefined);
  const carries = recipe.clips.filter((c) => c.carryGood !== undefined);
  if (new Set(recipe.clips.map((c) => c.name)).size !== recipe.clips.length)
    throw new Error('Duplicate clip name');
  const clips = [walk, idle, ...atomics.filter(storesPoses), ...carries],
    dirs = ['SW', 'W', 'NW', 'NE', 'E', 'SE', 'S', 'N'];
  const crop = recipe.runtimeCrop ?? {
    left: 48,
    top: recipe.post === 'soft-separation' ? 24 : 32,
    width: 96,
    height: recipe.post === 'soft-separation' ? 120 : 112,
  };
  const cellWidth = crop.width,
    cellHeight = crop.height;
  const columns = 8 * clips.reduce((sum, c) => sum + (c.frames ?? recipe.frames), 0) > 576 ? 40 : 24;
  const composites: OverlayOptions[] = [];
  let index = 0;
  for (const clip of clips)
    for (const facing of dirs) {
      const count = clip.frames ?? recipe.frames;
      const strip = sharp(resolve(directory, 'sprites', `${clip.name}-${facing}-88px.png`));
      const metadata = await strip.metadata();
      if (metadata.width !== 192 * count || metadata.height !== 144)
        throw new Error('Unexpected strip dimensions');
      for (let f = 0; f < count; f++) {
        const { data, info } = await strip
          .clone()
          .extract({ left: f * 192, top: 0, width: 192, height: 144 })
          .ensureAlpha()
          .raw()
          .toBuffer({ resolveWithObject: true });
        for (let y = 0; y < 144; y++)
          for (let x = 0; x < 192; x++)
            if (
              data[(y * 192 + x) * 4 + 3] &&
              (x < crop.left || x >= crop.left + cellWidth || y < crop.top || y >= crop.top + cellHeight)
            )
              throw new Error(`${id} ${clip.name}-${facing}:${f} exceeds runtime crop`);
        const input = await sharp(data, { raw: info }).extract(crop).png().toBuffer();
        composites.push({
          input,
          left: (index % columns) * cellWidth,
          top: Math.floor(index / columns) * cellHeight,
        });
        index++;
      }
    }
  let walkTravelPerCycle: number[] | undefined;
  if (recipe.walkCalibration) {
    const path = resolve(directory, recipe.walkCalibration);
    const m = z
      .object({
        source: z.string(),
        sha256: z.string(),
        orthoScale: z.number().positive(),
        groundTravelPerCycle: z.number().positive(),
      })
      .parse(JSON.parse(await readFile(path, 'utf8')));
    if (
      createHash('sha256')
        .update(await readFile(resolve(dirname(path), m.source)))
        .digest('hex') !== m.sha256
    )
      throw new Error('Walk calibration belongs to a different model');
    const layout = z
      .record(z.string(), z.object({ scale: z.number().positive() }))
      .parse(JSON.parse(await readFile(resolve(directory, 'layout.json'), 'utf8')));
    if (!recipe.walkPlayback) throw new Error('Missing walk playback');
    const playback = z
      .object({ cadenceScale: z.number().positive(), referenceFacing: z.string() })
      .parse(JSON.parse(await readFile(resolve(directory, recipe.walkPlayback), 'utf8')));
    const reference = layout[`walk-${playback.referenceFacing}`];
    if (!reference) throw new Error('Missing gait reference layout');
    const travel =
      (m.groundTravelPerCycle * ((recipe.render?.size ?? 512) / m.orthoScale) * reference.scale) /
      playback.cadenceScale;
    walkTravelPerCycle = dirs.map(() => travel);
  }
  const width = columns * cellWidth,
    height = Math.ceil(index / columns) * cellHeight;
  const shadow = shadowSource ? await characterShadow(directory, shadowSource) : undefined;
  if (shadow?.clips && shadow.clips.join(',') !== clips.map((c) => c.name).join(','))
    throw new Error('Shadow clip order differs from the body atlas; re-pack shadows');
  const manifest = ownCharacterManifest.parse({
    ...(shadow ? { shadow: shadow.manifest } : {}),
    id,
    name,
    width,
    height,
    cellWidth,
    cellHeight,
    columns,
    anchorX: 96 - crop.left,
    anchorY: 128 - crop.top,
    scale: 0.5,
    smoothMotion: recipe.post === 'soft-separation',
    filtering: recipe.post === 'soft-separation' ? 'linear' : 'nearest',
    walkFrames: walk.frames ?? recipe.frames,
    idleFrames: idle.frames ?? recipe.frames,
    walkDuration: walk.duration,
    ...(walk.frameDurations ? { walkFrameDurations: walk.frameDurations } : {}),
    ...(walk.frameOrder ? { walkFrameOrder: walk.frameOrder } : {}),
    walkTravelPerCycle,
    idleDuration: idle.duration,
    ...(idle.frameDurations ? { idleFrameDurations: idle.frameDurations } : {}),
    ...(idle.frameOrder ? { idleFrameOrder: idle.frameOrder } : {}),
    ...(atomics.length
      ? {
          atomicClips: atomics.map((c) => {
            const source = atomics.find((s) => s.name === c.poses);
            return {
              atomicId: c.atomicId,
              ...storedClip(c),
              ...(source === undefined ? {} : { poses: source.atomicId }),
            };
          }),
        }
      : {}),
    ...(carries.length
      ? {
          carryClips: carries.map((c) => ({
            good: c.carryGood,
            frames: c.frames ?? recipe.frames,
            duration: c.duration,
          })),
        }
      : {}),
    sourceBasis: `Generated character from docs/art/characters/${directory.replaceAll('\\', '/').split('/docs/art/characters/')[1]}; ${recipe.post} export. No original-game pixels.`,
  });
  const png = await sharp({ create: { width, height, channels: 4, background: '#00000000' } })
    .composite(composites)
    .png()
    .toBuffer();
  return { png, manifest };
}
