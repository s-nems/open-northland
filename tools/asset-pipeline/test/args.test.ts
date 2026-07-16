import { mkdir, rm, symlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertOutStaysInCheckout, parseArgs, resolveArgs, resolveModRoot } from '../src/args.js';
import { CULTURESNATION_MOD } from '../src/probe.js';
import { makeTempDir } from './support/game-tree.js';

describe('parseArgs', () => {
  it('reads --game/--mod-root/--out and defaults out to content', () => {
    expect(parseArgs(['--game', 'g', '--mod-root', 'm', '--out', 'o'])).toEqual({
      game: 'g',
      modRoot: 'm',
      out: 'o',
    });
    expect(parseArgs(['--game', 'g'])).toEqual({ game: 'g', modRoot: undefined, out: 'content' });
  });

  it('throws when --game is missing', () => {
    expect(() => parseArgs(['--mod-root', 'm'])).toThrow(/--game/);
  });

  it('rejects the retired --mod flag with the migration hint', () => {
    expect(() => parseArgs(['--game', 'g', '--mod', 'DataCnmd'])).toThrow(/--mod-root/);
  });
});

describe('resolveArgs', () => {
  // The bug this guards: npm runs the workspace `start` script with cwd=tools/asset-pipeline/, so a
  // relative `--game ../Cultures 8th Wonder` must resolve against INIT_CWD (repo root), not cwd.
  // Expected values are resolved from the PARENT dir (not composed as resolve(baseDir, arg) like the
  // implementation), so they independently prove the `..` collapsed against baseDir. `resolve()` in
  // the expectations keeps the test platform-agnostic (Windows adds a drive letter + backslashes).
  it('resolves relative game/mod-root/out against baseDir', () => {
    expect(
      resolveArgs(
        { game: '../Cultures 8th Wonder', modRoot: '../mods/CnMod 1.3.1', out: 'content' },
        resolve('/home/u/open-northland'),
      ),
    ).toEqual({
      game: resolve('/home/u/Cultures 8th Wonder'),
      modRoot: resolve('/home/u/mods/CnMod 1.3.1'),
      out: resolve('/home/u/open-northland/content'),
    });
  });

  it('passes absolute game/out through unchanged', () => {
    const game = resolve('/abs/game');
    const out = resolve('/abs/out');
    expect(resolveArgs({ game, modRoot: undefined, out }, resolve('/home/u/open-northland'))).toEqual({
      game,
      modRoot: undefined,
      out,
    });
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

  it('accepts an explicit mod root that contains DataCnmd/', async () => {
    const modRoot = join(base, 'CnMod 1.3.1');
    await mkdir(join(modRoot, CULTURESNATION_MOD), { recursive: true });
    await expect(resolveModRoot(join(base, 'game'), modRoot)).resolves.toBe(modRoot);
  });

  it('rejects an explicit mod root without DataCnmd/', async () => {
    const modRoot = join(base, 'not-a-mod');
    await mkdir(modRoot, { recursive: true });
    await expect(resolveModRoot(join(base, 'game'), modRoot)).rejects.toThrow(/DataCnmd/);
  });

  it('auto-detects a mod installed inside the game folder', async () => {
    const game = join(base, 'game');
    await mkdir(join(game, CULTURESNATION_MOD), { recursive: true });
    await expect(resolveModRoot(game, undefined)).resolves.toBe(game);
  });

  it('fails fast with the download pointer when no mod is found anywhere', async () => {
    const game = join(base, 'game');
    await mkdir(game, { recursive: true });
    await expect(resolveModRoot(game, undefined)).rejects.toThrow(/culturesnation\.pl/);
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
