import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
const script = resolve('tools/art-pipeline/authoring/characters/pack-character.mjs');

async function renderFigure(directory: string, height: number) {
  await mkdir(directory, { recursive: true });
  const figure = await sharp({ create: { width: 40, height, channels: 4, background: '#a4724f' } })
    .png()
    .toBuffer();
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#00000000' } })
    .composite([{ input: figure, left: 236, top: 400 - height }])
    .png()
    .toFile(join(directory, 'f00.png'));
}

it('packs the walk to the recipe sprite height and every other clip to the walk scale', async () => {
  const run = await mkdtemp(join(tmpdir(), 'character-height-'));
  const renders = join(run, 'renders');
  try {
    await writeFile(join(run, 'recipe.json'), JSON.stringify({ spriteHeight: 60 }));
    await renderFigure(join(renders, 'walk-SW'), 240);
    await renderFigure(join(renders, 'idle-SW'), 120);
    await execute('node', [script, run, renders, 'soft-separation']);
    const layout = JSON.parse(await readFile(join(run, 'layout.json'), 'utf8'));
    expect(layout['walk-SW'].scale).toBeCloseTo(0.25);
    expect(layout['idle-SW'].scale).toBeCloseTo(0.25);
    const { info } = await sharp(join(run, 'sprites/walk-SW-88px.png'))
      .trim({ threshold: 1 })
      .toBuffer({ resolveWithObject: true });
    // The soft-separation post adds up to a pixel of edge on each side.
    expect(info.height).toBeGreaterThanOrEqual(60);
    expect(info.height).toBeLessThanOrEqual(62);
  } finally {
    await rm(run, { recursive: true, force: true });
  }
});

it('rejects a sprite height that is not a positive number', async () => {
  const run = await mkdtemp(join(tmpdir(), 'character-height-'));
  const renders = join(run, 'renders');
  try {
    await writeFile(join(run, 'recipe.json'), JSON.stringify({ spriteHeight: 0 }));
    await renderFigure(join(renders, 'walk-SW'), 240);
    await expect(execute('node', [script, run, renders, 'soft-separation'])).rejects.toThrow('Sprite height');
  } finally {
    await rm(run, { recursive: true, force: true });
  }
});
