import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertOutStaysInCheckout, parseArgs, resolveArgs } from '../src/args.js';

describe('parseArgs', () => {
  it('reads --game/--mod/--out and defaults out to content', () => {
    expect(parseArgs(['--game', 'g', '--mod', 'm', '--out', 'o'])).toEqual({
      game: 'g',
      mod: 'm',
      out: 'o',
    });
    expect(parseArgs(['--game', 'g'])).toEqual({ game: 'g', mod: undefined, out: 'content' });
  });

  it('throws when --game is missing', () => {
    expect(() => parseArgs(['--mod', 'm'])).toThrow(/--game/);
  });
});

describe('resolveArgs', () => {
  // The bug this guards: npm runs the workspace `start` script with cwd=tools/asset-pipeline/, so a
  // relative `--game ../Cultures 8th Wonder` must resolve against INIT_CWD (repo root), not cwd.
  it('resolves relative game/out against baseDir; mod stays a bare subdir', () => {
    expect(
      resolveArgs(
        { game: '../Cultures 8th Wonder', mod: 'DataCnmd', out: 'content' },
        '/home/u/opennorthland',
      ),
    ).toEqual({
      game: '/home/u/Cultures 8th Wonder',
      mod: 'DataCnmd',
      out: '/home/u/opennorthland/content',
    });
  });

  it('passes absolute game/out through unchanged', () => {
    expect(
      resolveArgs({ game: '/abs/game', mod: undefined, out: '/abs/out' }, '/home/u/opennorthland'),
    ).toEqual({
      game: '/abs/game',
      mod: undefined,
      out: '/abs/out',
    });
  });
});

describe('assertOutStaysInCheckout', () => {
  // The bug this guards: a parallel worktree used to symlink its gitignored content/ at the primary
  // checkout's; a pipeline run there wrote through the symlink and clobbered the primary's content.
  let base: string;
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'opennorthland-out-guard-'));
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
