import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ownCharacterManifest } from '@open-northland/art-contracts';
import sharp, { type OverlayOptions } from 'sharp';
import { z } from 'zod';

const clipSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]+$/),
  frames: z.number().int().positive().optional(),
  duration: z.number().positive(),
  frameDurations: z.array(z.number().positive()).optional(),
  atomicId: z.number().int().nonnegative().optional(),
});
const characterRecipe = z.object({
  frames: z.number().int().positive(),
  post: z.string(),
  clips: z.array(clipSchema),
  walkCalibration: z.string().optional(),
  walkPlayback: z.string().optional(),
  render: z.object({ size: z.number().positive().optional() }).optional(),
});
export async function characterInputs(directory: string, source: string) {
  const raw = characterRecipe.parse(JSON.parse(await readFile(resolve(directory, source), 'utf8')));
  const inputs = [resolve(directory, source)];
  for (const clip of raw.clips)
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
  return inputs;
}
export async function packCharacter(directory: string, source: string, id: string, name: string) {
  const recipe = characterRecipe.parse(JSON.parse(await readFile(resolve(directory, source), 'utf8')));
  const walk = recipe.clips.find((c) => c.name === 'walk'),
    idle = recipe.clips.find((c) => c.name === 'idle');
  if (!walk || !idle) throw new Error('Both walk and idle required');
  const atomics = recipe.clips.filter((c) => c.atomicId !== undefined);
  if (new Set(recipe.clips.map((c) => c.name)).size !== recipe.clips.length)
    throw new Error('Duplicate clip name');
  const clips = [walk, idle, ...atomics],
    dirs = ['SW', 'W', 'NW', 'NE', 'E', 'SE', 'S', 'N'];
  const cellWidth = 96,
    cellHeight = recipe.post === 'soft-separation' ? 120 : 112;
  const columns = 8 * clips.reduce((sum, c) => sum + (c.frames ?? recipe.frames), 0) > 576 ? 40 : 24;
  const cropTop = 144 - cellHeight,
    composites: OverlayOptions[] = [];
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
            if (data[(y * 192 + x) * 4 + 3] && (x < 48 || x >= 144 || y < cropTop))
              throw new Error(`${id} ${clip.name}-${facing}:${f} exceeds runtime crop`);
        const input = await sharp(data, { raw: info })
          .extract({ left: 48, top: cropTop, width: cellWidth, height: cellHeight })
          .png()
          .toBuffer();
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
  const manifest = ownCharacterManifest.parse({
    id,
    name,
    width,
    height,
    cellWidth,
    cellHeight,
    columns,
    anchorX: 48,
    anchorY: 128 - cropTop,
    scale: 0.5,
    smoothMotion: recipe.post === 'soft-separation',
    filtering: recipe.post === 'soft-separation' ? 'linear' : 'nearest',
    walkFrames: walk.frames ?? recipe.frames,
    idleFrames: idle.frames ?? recipe.frames,
    walkDuration: walk.duration,
    walkTravelPerCycle,
    idleDuration: idle.duration,
    ...(idle.frameDurations ? { idleFrameDurations: idle.frameDurations } : {}),
    ...(atomics.length
      ? {
          atomicClips: atomics.map((c) => ({
            atomicId: c.atomicId,
            frames: c.frames ?? recipe.frames,
            duration: c.duration,
            ...(c.frameDurations ? { frameDurations: c.frameDurations } : {}),
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
