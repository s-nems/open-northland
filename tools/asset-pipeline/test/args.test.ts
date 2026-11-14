import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DATA_PACK_VERSION } from '../../../scripts/data-pack.mjs';
import { assertOutStaysInCheckout, parseArgs, resolveArgs } from '../src/args.js';
import { resolveDataPack } from '../src/roots.js';
import { makeTempDir } from './support/game-tree.js';

describe('parseArgs', () => {
  it('reads --data-root/--out and defaults out to content', () => {
    expect(parseArgs(['--data-root', 'm', '--out', 'o'])).toEqual({ dataRoot: 'm', out: 'o' });
    expect(parseArgs(['--data-root', 'm'])).toEqual({ dataRoot: 'm', out: 'content' });
  });

  it('throws the usage when --data-root is missing', () => {
    expect(() => parseArgs(['--out', 'o'])).toThrow(/--data-root <dir>/);
  });
});

describe('resolveArgs', () => {
  // The bug this guards: npm runs the workspace `start` script with cwd=tools/asset-pipeline/, so a
  // relative `--data-root ../data-pack` must resolve against INIT_CWD (repo root), not cwd.
  // Expected values are resolved from the PARENT dir (not composed as resolve(baseDir, arg) like the
  // implementation), so they independently prove the `..` collapsed against baseDir. `resolve()` in
  // the expectations keeps the test platform-agnostic (Windows adds a drive letter + backslashes).
  it('resolves a relative data-root and out against baseDir', () => {
    expect(
      resolveArgs({ dataRoot: '../packs/data-pack', out: 'content' }, resolve('/home/u/open-northland')),
    ).toEqual({
      dataRoot: resolve('/home/u/packs/data-pack'),
      out: resolve('/home/u/open-northland/content'),
    });
  });

  it('passes an absolute data-root and out through unchanged', () => {
    const dataRoot = resolve('/abs/data');
    const out = resolve('/abs/out');
    expect(resolveArgs({ dataRoot, out }, resolve('/home/u/open-northland'))).toEqual({ dataRoot, out });
  });
});

describe('resolveDataPack', () => {
  let base: string;
  beforeEach(async () => {
    base = (await makeTempDir('data-root')).path;
  });
  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('rejects an unpacked directory without a data manifest', async () => {
    await mkdir(join(base, 'extras'), { recursive: true });
    await expect(resolveDataPack(base)).rejects.toThrow(/manifest.json/);
  });

  it('exposes the base tree and the campaigns of a valid pack', async () => {
    await mkdir(join(base, 'base', 'rules'), { recursive: true });
    await writeFile(
      join(base, 'manifest.json'),
      JSON.stringify({
        format: 'open-northland-data',
        version: DATA_PACK_VERSION,
        base: 'base',
        components: [{ id: 'synthetic', kind: 'base', sha256: '0'.repeat(64) }],
        campaigns: [],
        files: [],
      }),
    );
    await expect(resolveDataPack(base)).resolves.toEqual({
      root: base,
      base: join(base, 'base'),
      campaigns: [],
    });
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
