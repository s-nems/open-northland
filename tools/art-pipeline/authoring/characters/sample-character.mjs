import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const runArg = process.argv[2];
if (!runArg) throw new Error('usage: node sample-character.mjs <character dir>');
const run = resolve(runArg);
const recipe = JSON.parse(readFileSync(join(run, 'recipe.json'), 'utf8'));
const source = resolve(run, recipe.sampleSource);
const sourceRecipe = JSON.parse(readFileSync(join(source, 'recipe.json'), 'utf8'));
mkdirSync(join(run, 'sprites'), { recursive: true });
const receipts = [];
for (const clip of recipe.clips) {
  const original = sourceRecipe.clips.find((c) => c.name === clip.name);
  const indices = clip.sourceFrames;
  const sourceFrames = original?.frames ?? sourceRecipe.frames;
  const frames = clip.frames ?? recipe.frames;
  if (
    !original ||
    !Number.isInteger(sourceFrames) ||
    sourceFrames <= 0 ||
    !Number.isInteger(frames) ||
    frames <= 0 ||
    !Array.isArray(indices) ||
    indices.length !== frames ||
    indices.some((i) => !Number.isInteger(i) || i < 0 || i >= sourceFrames)
  )
    throw new Error('Invalid source frame selection');
  if (
    clip.frameDurations &&
    (clip.frameDurations.length !== (clip.frameOrder?.length ?? frames) ||
      clip.frameDurations.some((d) => !(d > 0)) ||
      Math.abs(clip.frameDurations.reduce((a, b) => a + b, 0) - clip.duration) > 1e-6)
  )
    throw new Error('Invalid pose timing');
  for (const facing of clip.facings) {
    const file = `${clip.name}-${facing}-88px.png`;
    const bytes = readFileSync(join(source, 'sprites', file));
    const { data: sourcePixels, info } = await sharp(bytes)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== sourceFrames * 192 || info.height !== 144 || info.channels !== 4)
      throw new Error(`Invalid source strip dimensions: ${file}`);
    const width = 192 * indices.length;
    const output = Buffer.alloc(width * 144 * 4);
    for (const [index, frame] of indices.entries()) {
      for (let row = 0; row < 144; row++) {
        const start = (row * sourceFrames * 192 + frame * 192) * 4;
        sourcePixels.copy(output, (row * width + index * 192) * 4, start, start + 192 * 4);
      }
    }
    await sharp(output, { raw: { width, height: 144, channels: 4 } })
      .png()
      .toFile(join(run, 'sprites', file));
    receipts.push({ file, sourceSha256: createHash('sha256').update(bytes).digest('hex') });
  }
}
writeFileSync(
  join(run, 'sampling.json'),
  JSON.stringify(
    {
      source: recipe.sampleSource,
      basis:
        'Selected generated source pixels; walk samples approximate uniform phase at the source 32-pose resolution; idle poses and holds are authored approximations.',
      strips: receipts,
    },
    null,
    2,
  ) + '\n',
);
console.log('Sampled', receipts.length, 'strips');
