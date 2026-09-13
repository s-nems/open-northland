import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { expect, it } from 'vitest';

it.each([
  0.2, 0.8,
])('packs and tightly crops shadows at scale %s without clipping long tools', async (scale) => {
  const run = await mkdtemp(path.join(os.tmpdir(), 'shadow-pack-'));
  try {
    const layout: Record<string, unknown> = {};
    await mkdir(path.join(run, 'sprites'));
    const source = await sharp({
      create: {
        width: 768,
        height: 768,
        channels: 4,
        background: '#00000000',
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 80,
              height: 40,
              channels: 4,
              background: '#ffffff',
            },
          })
            .png()
            .toBuffer(),
          left: scale > 0.5 ? 600 : 360,
          top: 400,
        },
      ])
      .png()
      .toBuffer();
    for (const clip of ['walk', 'idle']) {
      for (const facing of ['SW', 'W', 'NW', 'N', 'NE', 'E', 'SE', 'S']) {
        const name = `${clip}-${facing}`;
        const directory = path.join(run, '.work/shadow-render', name);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, 'inputs.json'), '{}');
        await writeFile(path.join(directory, 'f00.png'), source);
        await writeFile(path.join(run, 'sprites', `${name}-88px.png`), 'body hash fixture');
        layout[name] = {
          box: { left: 206, top: 200, width: 100, height: 100 },
          scale,
        };
      }
    }
    await writeFile(
      path.join(run, 'recipe.json'),
      JSON.stringify({
        frames: 1,
        clips: [{ name: 'walk' }, { name: 'idle' }],
      }),
    );
    await writeFile(path.join(run, 'layout.json'), JSON.stringify(layout));
    await promisify(execFile)('node', ['tools/art-pipeline/authoring/characters/pack-shadows.mjs', run]);
    const metadata = JSON.parse(await readFile(path.join(run, 'shadows/shadow.json'), 'utf8')) as {
      cellWidth: number;
      cellHeight: number;
      anchorX: number;
      anchorY: number;
    };
    const cell = await sharp(path.join(run, 'shadows/atlas.png'))
      .extract({
        left: 0,
        top: 0,
        width: metadata.cellWidth,
        height: metadata.cellHeight,
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const centerX = metadata.anchorX + Math.round(((scale > 0.5 ? 640 : 400) - 384) * scale);
    const centerY = metadata.anchorY + Math.round((420 - 428) * scale);
    expect(cell.data[(centerY * cell.info.width + centerX) * 4 + 3]).toBeGreaterThan(0);
    expect(metadata.cellWidth).toBeLessThan((scale > 0.5 ? 300 : 80) * scale + 20);
    const pixels = await sharp(path.join(run, 'shadows/atlas.png')).ensureAlpha().raw().toBuffer();
    let maxAlpha = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      expect(pixels[i]).toBe(0);
      expect(pixels[i + 1]).toBe(0);
      expect(pixels[i + 2]).toBe(0);
      maxAlpha = Math.max(maxAlpha, pixels[i + 3] ?? 0);
    }
    const profile = JSON.parse(await readFile('docs/art/lighting.json', 'utf8')) as {
      shadow: { characterOpacity: number };
    };
    expect(maxAlpha).toBe(Math.round(255 * profile.shadow.characterOpacity));
  } finally {
    await rm(run, { recursive: true, force: true });
  }
}, 30000);
