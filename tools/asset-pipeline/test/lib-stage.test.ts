import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeLib } from '../src/decoders/lib.js';
import { libMemberRelPath, unpackLibTree } from '../src/stages/lib.js';
import { makeTempDir } from './support/game-tree.js';

describe('libMemberRelPath', () => {
  it('rewrites backslash member paths to a native relative path', () => {
    expect(libMemberRelPath('data\\engine2d\\bin\\bobs\\ls_bridge.bmd')).toBe(
      join('data', 'engine2d', 'bin', 'bobs', 'ls_bridge.bmd'),
    );
    expect(libMemberRelPath('logo.pcx')).toBe('logo.pcx');
  });

  it('rejects names that would escape the extraction root', () => {
    expect(libMemberRelPath('..\\..\\etc\\passwd')).toBeUndefined();
    expect(libMemberRelPath('a\\..\\..\\b')).toBeUndefined();
    expect(libMemberRelPath('')).toBeUndefined();
    expect(libMemberRelPath('.')).toBeUndefined();
  });
});

describe('unpackLibTree', () => {
  let game: string;
  let out: string;

  beforeEach(async () => {
    const root = (await makeTempDir('lib')).path;
    game = join(root, 'game');
    out = join(root, 'out');
    await mkdir(game, { recursive: true });
  });

  afterEach(async () => {
    await rm(join(game, '..'), { recursive: true, force: true });
  });

  it('extracts every member of every .lib under the game tree, mirroring its internal path', async () => {
    const lib = encodeLib({
      files: [
        { name: 'data\\logic\\goodtypes.cif', data: Uint8Array.from([1, 2, 3, 4]) },
        { name: 'logo.pcx', data: Uint8Array.from([9, 8, 7]) },
      ],
    });
    await mkdir(join(game, 'DataX', 'Libs'), { recursive: true });
    await writeFile(join(game, 'DataX', 'Libs', 'data0001.lib'), lib);
    await writeFile(join(game, 'notes.txt'), 'ignore me'); // not a .lib

    const done = await unpackLibTree(game, out);

    expect(done.map((e) => e.member).sort()).toEqual([join('data', 'logic', 'goodtypes.cif'), 'logo.pcx']);
    expect(done.every((e) => e.archive === join('DataX', 'Libs', 'data0001.lib'))).toBe(true);
    // The bytes that survived the round-trip must equal what we packed.
    expect(Array.from(await readFile(join(out, 'data', 'logic', 'goodtypes.cif')))).toEqual([1, 2, 3, 4]);
    expect(Array.from(await readFile(join(out, 'logo.pcx')))).toEqual([9, 8, 7]);
  });

  it('skips a member with an unsafe (escaping) name instead of writing outside out', async () => {
    const lib = encodeLib({
      files: [
        { name: '..\\escape.bin', data: Uint8Array.from([1]) },
        { name: 'safe.bin', data: Uint8Array.from([2]) },
      ],
    });
    await writeFile(join(game, 'a.lib'), lib);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await unpackLibTree(game, out);

    expect(done.map((e) => e.member)).toEqual(['safe.bin']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/unsafe member ".*escape\.bin"/));
    warn.mockRestore();
  });

  it('skips a corrupt .lib with a warning instead of aborting the batch', async () => {
    const good = encodeLib({ files: [{ name: 'ok.bin', data: Uint8Array.from([5]) }] });
    await writeFile(join(game, 'good.lib'), good);
    await writeFile(join(game, 'broken.lib'), Uint8Array.from([1, 0, 0])); // truncated header
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const done = await unpackLibTree(game, out);

    expect(done.map((e) => e.member)).toEqual(['ok.bin']);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/skipped archive broken\.lib:/));
    warn.mockRestore();
  });

  it('throws when the game dir does not exist (a real argument error, not per-file)', async () => {
    await expect(unpackLibTree(join(game, 'nope'), out)).rejects.toThrow();
  });
});
