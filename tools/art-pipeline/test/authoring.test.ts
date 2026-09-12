import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { packCharacter } from '../src/character.js';
import { writeJson } from '../src/files.js';

const execute = promisify(execFile);
const script = resolve('tools/art-pipeline/authoring/characters/sample-character.mjs');
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it('preserves large tool pixels and the foot anchor with an expanded runtime crop', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-character-crop-'));
  roots.push(root);
  await mkdir(join(root, 'sprites'));
  const recipe = {
    frames: 1,
    post: 'soft-separation',
    clips: [
      { name: 'walk', duration: 1 },
      { name: 'idle', duration: 1 },
    ],
  };
  const pixels = Buffer.alloc(192 * 144 * 4);
  pixels.set([160, 110, 50, 255], (12 * 192 + 32) * 4);
  pixels.set([70, 50, 30, 255], (128 * 192 + 96) * 4);
  const png = await sharp(pixels, { raw: { width: 192, height: 144, channels: 4 } })
    .png()
    .toBuffer();
  for (const clip of recipe.clips)
    for (const facing of ['SW', 'W', 'NW', 'NE', 'E', 'SE', 'S', 'N'])
      await sharp(png).toFile(join(root, `sprites/${clip.name}-${facing}-88px.png`));
  await writeJson(join(root, 'recipe.json'), recipe);
  await expect(packCharacter(root, 'recipe.json', 'test', 'Test')).rejects.toThrow('exceeds runtime crop');
  await writeJson(join(root, 'recipe.json'), {
    ...recipe,
    runtimeCrop: { left: 24, top: 0, width: 144, height: 144 },
  });
  const packed = await packCharacter(root, 'recipe.json', 'test', 'Test');
  expect(packed.manifest).toMatchObject({
    cellWidth: 144,
    cellHeight: 144,
    anchorX: 72,
    anchorY: 128,
    scale: 0.5,
  });
  const cell = await sharp(packed.png).extract({ left: 0, top: 0, width: 144, height: 144 }).raw().toBuffer();
  expect([...cell.subarray((12 * 144 + 8) * 4, (12 * 144 + 8) * 4 + 4)]).toEqual([160, 110, 50, 255]);
  expect([...cell.subarray((128 * 144 + 72) * 4, (128 * 144 + 72) * 4 + 4)]).toEqual([70, 50, 30, 255]);
  await writeJson(join(root, 'recipe.json'), {
    ...recipe,
    runtimeCrop: { left: 24, top: 0, width: 192, height: 144 },
  });
  await expect(packCharacter(root, 'recipe.json', 'test', 'Test')).rejects.toThrow('Crop must fit');
});

it('samples recipe-level frame counts and rejects malformed source strips', async () => {
  const root = await mkdtemp(join(tmpdir(), 'art-authoring-'));
  roots.push(root);
  const source = join(root, 'source');
  const run = join(root, 'sample');
  await mkdir(join(source, 'sprites'), { recursive: true });
  await writeJson(join(source, 'recipe.json'), { frames: 2, clips: [{ name: 'idle' }] });
  await writeJson(join(run, 'recipe.json'), {
    frames: 1,
    sampleSource: '../source',
    clips: [{ name: 'idle', duration: 1, sourceFrames: [1], facings: ['SW'] }],
  });
  const pixels = Buffer.alloc(384 * 144 * 4);
  for (let y = 0; y < 144; y++)
    for (let x = 192; x < 384; x++) pixels.set([120, 80, 30, 255], (y * 384 + x) * 4);
  const strip = join(source, 'sprites/idle-SW-88px.png');
  await sharp(pixels, { raw: { width: 384, height: 144, channels: 4 } })
    .png()
    .toFile(strip);
  await execute(process.execPath, [script, run]);
  const sampled = await sharp(join(run, 'sprites/idle-SW-88px.png')).raw().toBuffer();
  expect([...sampled.subarray(0, 4)]).toEqual([120, 80, 30, 255]);
  expect([...sampled.subarray(-4)]).toEqual([120, 80, 30, 255]);
  await sharp({ create: { width: 192, height: 144, channels: 4, background: '#00000000' } })
    .png()
    .toFile(strip);
  await expect(execute(process.execPath, [script, run])).rejects.toThrow('Invalid source strip dimensions');
});
