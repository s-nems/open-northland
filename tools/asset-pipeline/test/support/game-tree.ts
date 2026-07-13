import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Shared temp-workspace scaffolding for the stage tests. Every stage spec lays synthesized (never
 * copyrighted) sources into a throwaway game tree, runs a stage into a sibling out dir, and tears the
 * whole thing down — this module is the one copy of that dance so a spec declares what it writes, not
 * how a temp dir is made.
 */

/** Relative path of the engine bob directory under a game tree — the pipeline's `/bobs/` I/O convention. */
export const BOBS_DIR = join('Data', 'engine2d', 'bin', 'bobs');

/** A disposable OS temp directory; `cleanup()` removes it recursively (call from `afterEach`). */
export interface TempDir {
  readonly path: string;
  cleanup(): Promise<void>;
}

/** Makes an `opennorthland-<label>-XXXXXX` temp dir under the OS tmpdir. */
export async function makeTempDir(label: string): Promise<TempDir> {
  const path = await mkdtemp(join(tmpdir(), `opennorthland-${label}-`));
  return { path, cleanup: () => rm(path, { recursive: true, force: true }) };
}

/** A temp workspace with the pipeline's `game`/`out` split plus a helper to lay files into the game tree. */
export interface GameOutTemp {
  readonly root: string;
  readonly game: string;
  readonly out: string;
  /** Writes `bytes` at `rel` under the game tree, creating parent directories first. */
  write(rel: string, bytes: Uint8Array): Promise<void>;
  cleanup(): Promise<void>;
}

/**
 * Makes a `game`/`out` temp workspace: the game dir exists and is ready to receive synthesized sources
 * via `write`; the out dir is left for the stage under test to create.
 */
export async function makeGameOutTemp(label: string): Promise<GameOutTemp> {
  const { path: root, cleanup } = await makeTempDir(label);
  const game = join(root, 'game');
  const out = join(root, 'out');
  await mkdir(game, { recursive: true });
  return {
    root,
    game,
    out,
    async write(rel, bytes) {
      const path = join(game, rel);
      await mkdir(join(path, '..'), { recursive: true });
      await writeFile(path, bytes);
    },
    cleanup,
  };
}
