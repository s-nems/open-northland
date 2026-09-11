import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { writeJson } from '../src/files.js';

const execute = promisify(execFile);
const script = resolve('tools/art-pipeline/authoring/characters/sample-character.mjs');
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
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
