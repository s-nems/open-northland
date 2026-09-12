import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { expect, it } from 'vitest';

const execute = promisify(execFile);
const script = resolve('tools/art-pipeline/authoring/characters/pack-character.mjs');

it('preserves foot placement with render padding and rejects a clipped source before packing', async () => {
  const run = await mkdtemp(join(tmpdir(), 'character-padding-'));
  const renders = join(run, 'renders');
  const directory = join(renders, 'mining-SW');
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(run, 'layout.json'),
      JSON.stringify({
        'mining-SW': { box: { left: 24, top: 20, width: 16, height: 30 }, scale: 1 },
      }),
    );
    const figure = await sharp({ create: { width: 16, height: 30, channels: 4, background: '#a4724f' } })
      .png()
      .toBuffer();
    async function render(padding: number, clipped = false) {
      await sharp({
        create: { width: 64 + 2 * padding, height: 64 + 2 * padding, channels: 4, background: '#00000000' },
      })
        .composite([{ input: figure, left: clipped ? 0 : 24 + padding, top: 20 + padding }])
        .png()
        .toFile(join(directory, 'f00.png'));
      await writeFile(join(directory, 'projection.json'), JSON.stringify({ padding }));
    }
    await render(0);
    await execute('node', [script, run, renders, 'soft-separation']);
    const baseline = await readFile(join(run, 'sprites/mining-SW-88px.png'));
    await render(32);
    await execute('node', [script, run, renders, 'soft-separation']);
    expect(await readFile(join(run, 'sprites/mining-SW-88px.png'))).toEqual(baseline);
    await render(0, true);
    await expect(execute('node', [script, run, renders, 'soft-separation'])).rejects.toThrow(
      'Clipped source render',
    );
  } finally {
    await rm(run, { recursive: true, force: true });
  }
});
