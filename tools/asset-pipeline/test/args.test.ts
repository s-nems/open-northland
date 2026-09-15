import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertOutStaysInCheckout, parseArgs, resolveArgs } from '../src/args.js';
import { CULTURESNATION_MOD } from '../src/mod-root.js';
import { resolveModRoot } from '../src/roots.js';
import { makeTempDir } from './support/game-tree.js';

describe('parseArgs', () => {
  it('reads --mod-root/--out and defaults out to content', () => {
    expect(parseArgs(['--mod-root', 'm', '--out', 'o'])).toEqual({ modRoot: 'm', out: 'o' });
    expect(parseArgs(['--mod-root', 'm'])).toEqual({ modRoot: 'm', out: 'content' });
  });

  it('preserves an explicit mod release label independently of paths', () => {
    const args = parseArgs(['--mod-root', 'm', '--mod-version', '1.3.2']);
    expect(args.modVersion).toBe('1.3.2');
    expect(resolveArgs(args, '/tmp').modVersion).toBe('1.3.2');
    expect(parseArgs(['--mod-root', 'm']).modVersion).toBeUndefined();
    for (const value of ['', ' ', '--out', 'x'.repeat(129)]) {
      expect(() => parseArgs(['--mod-root', 'm', '--mod-version', value])).toThrow(/mod-version/);
    }
    expect(() => parseArgs(['--mod-root', 'm', '--mod-version'])).toThrow(/mod-version/);
  });

  it('throws the usage when --mod-root is missing', () => {
    expect(() => parseArgs(['--out', 'o'])).toThrow(/--mod-root <dir>/);
  });
});

describe('resolveArgs', () => {
  // The bug this guards: npm runs the workspace `start` script with cwd=tools/asset-pipeline/, so a
  // relative `--mod-root ../CNMod-1.3.2` must resolve against INIT_CWD (repo root), not cwd.
  // Expected values are resolved from the PARENT dir (not composed as resolve(baseDir, arg) like the
  // implementation), so they independently prove the `..` collapsed against baseDir. `resolve()` in
  // the expectations keeps the test platform-agnostic (Windows adds a drive letter + backslashes).
  it('resolves a relative mod-root and out against baseDir', () => {
    expect(
      resolveArgs({ modRoot: '../mods/CNMod-1.3.2', out: 'content' }, resolve('/home/u/open-northland')),
    ).toEqual({
      modRoot: resolve('/home/u/mods/CNMod-1.3.2'),
      out: resolve('/home/u/open-northland/content'),
    });
  });

  it('passes an absolute mod-root and out through unchanged', () => {
    const modRoot = resolve('/abs/mod');
    const out = resolve('/abs/out');
    expect(resolveArgs({ modRoot, out }, resolve('/home/u/open-northland'))).toEqual({ modRoot, out });
  });
});

describe('resolveModRoot', () => {
  let base: string;
  beforeEach(async () => {
    base = (await makeTempDir('mod-root')).path;
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('accepts a mod root that contains DataCnmd/', async () => {
    const modRoot = join(base, 'CnMod 1.3.2');
    await mkdir(join(modRoot, CULTURESNATION_MOD), { recursive: true });
    await expect(resolveModRoot(modRoot)).resolves.toBe(modRoot);
  });

  it('rejects a mod root without DataCnmd/, pointing at the download', async () => {
    const modRoot = join(base, 'not-a-mod');
    await mkdir(modRoot, { recursive: true });
    await expect(resolveModRoot(modRoot)).rejects.toThrow(/DataCnmd.*culturesnation\.pl/s);
  });

  it('rejects a DataCnmd that is a file, not a directory', async () => {
    const modRoot = join(base, 'file-mod');
    await mkdir(modRoot, { recursive: true });
    await writeFile(join(modRoot, CULTURESNATION_MOD), 'not a directory');
    await expect(resolveModRoot(modRoot)).rejects.toThrow(/DataCnmd/);
  });
});

describe('assertOutStaysInCheckout', () => {
  // The bug this guards: a parallel worktree used to symlink its gitignored content/ at the primary
  // checkout's; a pipeline run there wrote through the symlink and clobbered the primary's content.
  let base: string;
  beforeEach(async () => {
    base = (await makeTempDir('out-guard')).path;
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('allows a real out dir inside the checkout, and a not-yet-existing one', async () => {
    const checkout = join(base, 'worktree');
    await mkdir(join(checkout, 'content'), { recursive: true });
    expect(() => assertOutStaysInCheckout(join(checkout, 'content'), checkout)).not.toThrow();
    expect(() => assertOutStaysInCheckout(join(checkout, 'not-yet-created'), checkout)).not.toThrow();
  });

  it('refuses an out symlinked to another checkout, but allows an explicit real path elsewhere', async () => {
    const primary = join(base, 'primary', 'content');
    const worktree = join(base, 'worktree');
    await mkdir(primary, { recursive: true });
    await mkdir(worktree, { recursive: true });
    await symlink(primary, join(worktree, 'content'));
    expect(() => assertOutStaysInCheckout(join(worktree, 'content'), worktree)).toThrow(/symlink/);
    // Naming the foreign directory directly (no indirection) stays a supported invocation.
    expect(() => assertOutStaysInCheckout(primary, worktree)).not.toThrow();
  });
});
