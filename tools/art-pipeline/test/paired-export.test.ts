import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { expect, it } from 'vitest';

it('exports and packs matching shadows through the normal animation command', async () => {
  const run = await mkdtemp(path.join(tmpdir(), 'paired-animation-'));
  try {
    const makeFrame = async (size: number, width: number, height: number, left: number, top: number) =>
      sharp({ create: { width: size, height: size, channels: 4, background: '#00000000' } })
        .composite([
          {
            input: await sharp({ create: { width, height, channels: 4, background: '#ffffff' } })
              .png()
              .toBuffer(),
            left,
            top,
          },
        ])
        .png()
        .toBuffer();
    await writeFile(path.join(run, 'body.png'), await makeFrame(512, 100, 200, 206, 200));
    await writeFile(path.join(run, 'silhouette.png'), await makeFrame(768, 80, 30, 370, 510));
    await mkdir(path.join(run, 'projected'));
    const facings = ['SW', 'W', 'NW', 'N', 'NE', 'E', 'SE', 'S'];
    for (const facing of facings)
      await writeFile(path.join(run, 'projected', `texture-${facing}.png`), 'synthetic texture');
    for (const clip of ['walk', 'idle']) await writeFile(path.join(run, `${clip}.glb`), 'synthetic geometry');
    await writeFile(path.join(run, 'asset.json'), '{}');
    await writeFile(
      path.join(run, 'recipe.json'),
      JSON.stringify({
        angle: 15,
        frames: 2,
        sprite: {},
        render: { toon: 0, size: 512, unlit: true },
        post: 'soft-separation',
        clips: ['walk', 'idle'].map((name) => ({
          name,
          file: `${name}.glb`,
          frames: 2,
          facings,
          samplePhases: [0, 0.75],
          duration: 1,
        })),
      }),
    );
    const fakeBlender = path.join(run, 'blender.py');
    await writeFile(
      fakeBlender,
      `#!/usr/bin/env python3
import sys,json,shutil
from pathlib import Path
root=Path(__file__).parent
args=sys.argv[sys.argv.index('--')+1:]
with (root/'calls.jsonl').open('a') as f: f.write(json.dumps(args)+'\\n')
out=Path(args[args.index('--out')+1])
source=root/('silhouette.png' if '--shadow-only' in args else 'body.png')
for i in range(int(args[args.index('--frames')+1])): shutil.copyfile(source,out/f'f{i:02d}.png')
`,
    );
    await chmod(fakeBlender, 0o755);
    // Windows cannot spawn a shebang script directly, so a .cmd shim hands it to python3.
    const blender = process.platform === 'win32' ? path.join(run, 'blender.cmd') : fakeBlender;
    if (blender !== fakeBlender) await writeFile(blender, '@python3 "%~dp0blender.py" %*\r\n');
    await promisify(execFile)(
      'python3',
      ['tools/art-pipeline/authoring/characters/run-character.py', run, run, 'render', 'pack'],
      { env: { ...process.env, BLENDER: blender } },
    );
    const calls = (await readFile(path.join(run, 'calls.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as string[]);
    expect(calls.filter((args) => args.includes('--shadow-only'))).toHaveLength(16);
    expect(calls.filter((args) => !args.includes('--shadow-only'))).toHaveLength(16);
    const renderOptions = (args: string[]) =>
      args.filter((arg, i) => arg !== '--shadow-only' && arg !== '--out' && args[i - 1] !== '--out');
    expect(calls.filter((args) => args.includes('--shadow-only')).map(renderOptions)).toEqual(
      calls.filter((args) => !args.includes('--shadow-only')).map(renderOptions),
    );
    for (const args of calls) {
      expect(args[args.indexOf('--frames') + 1]).toBe('2');
      expect(args[args.indexOf('--sample-phases') + 1]).toBe('0,0.75');
    }
    const receipt = JSON.parse(await readFile(path.join(run, 'shadows/shadow.json'), 'utf8')) as {
      inputs: Record<string, string>;
    };
    expect(receipt.inputs['layout.json']).toMatch(/^[a-f0-9]{64}$/);
    for (const name of ['walk', 'idle'])
      for (const facing of facings)
        expect(receipt.inputs[`sprites/${name}-${facing}-88px.png`]).toMatch(/^[a-f0-9]{64}$/);
    expect((await sharp(path.join(run, 'shadows/atlas.png')).metadata()).width).toBeGreaterThan(0);
  } finally {
    await rm(run, { recursive: true, force: true });
  }
}, 30000);
