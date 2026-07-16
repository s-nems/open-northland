import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { encodeLib } from '../src/decoders/lib.js';
import { probeGameFolder } from '../src/probe.js';
import { unpackLibTree } from '../src/stages/lib.js';
import { makeTempDir, type TempDir } from './support/game-tree.js';

/**
 * The progress seam (`src/progress.ts`) + the installer's game-folder probe (`src/probe.ts`).
 * The item reporter is best-effort telemetry: a stage ticks once per written item and behaves
 * identically when no reporter is passed (the CLI path).
 */

const dirs: TempDir[] = [];

async function tempDir(label: string): Promise<string> {
  const dir = await makeTempDir(label);
  dirs.push(dir);
  return dir.path;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => d.cleanup()));
});

describe('unpackLibTree item reporting', () => {
  it('ticks once per extracted member with a running done count', async () => {
    const game = await tempDir('progress-game');
    const out = await tempDir('progress-out');
    await writeFile(
      join(game, 'data0001.lib'),
      encodeLib({
        files: [
          { name: 'a.txt', data: Uint8Array.from([1]) },
          { name: 'sub\\b.txt', data: Uint8Array.from([2]) },
        ],
      }),
    );
    const ticks: number[] = [];
    const extracted = await unpackLibTree(game, out, (done) => ticks.push(done));
    expect(extracted).toHaveLength(2);
    expect(ticks).toEqual([1, 2]);
  });
});

describe('probeGameFolder', () => {
  it('finds a nested .lib and the mod dir', async () => {
    const game = await tempDir('probe-game');
    await mkdir(join(game, 'DataX', 'Libs'), { recursive: true });
    await mkdir(join(game, 'DataCnmd'));
    await writeFile(join(game, 'DataX', 'Libs', 'data0001.lib'), 'x');
    expect(await probeGameFolder(game)).toEqual({ hasArchives: true, hasMod: true });
  });

  it('rejects a folder without archives and tolerates a missing path', async () => {
    const empty = await tempDir('probe-empty');
    await mkdir(join(empty, 'Data'));
    expect(await probeGameFolder(empty)).toEqual({ hasArchives: false, hasMod: false });
    expect(await probeGameFolder(join(empty, 'no-such-dir'))).toEqual({
      hasArchives: false,
      hasMod: false,
    });
  });

  it('does not scan past the depth bound', async () => {
    const deep = await tempDir('probe-deep');
    const buried = join(deep, 'a', 'b', 'c', 'd', 'e');
    await mkdir(buried, { recursive: true });
    await writeFile(join(buried, 'data0001.lib'), 'x');
    expect((await probeGameFolder(deep)).hasArchives).toBe(false);
  });
});
