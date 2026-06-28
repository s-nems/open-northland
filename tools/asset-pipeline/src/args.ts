import { resolve } from 'node:path';

export interface Args {
  game: string;
  mod: string | undefined;
  out: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const game = get('--game');
  if (game === undefined) {
    throw new Error('usage: pipeline --game <dir> [--mod <subdir>] [--out <dir>]');
  }
  return { game, mod: get('--mod'), out: get('--out') ?? 'content' };
}

/**
 * Resolves the filesystem args (`game`, `out`) against `baseDir`, leaving absolute paths untouched.
 * The entry point passes `process.env.INIT_CWD` — the directory `npm run` was invoked from. npm runs
 * a workspace script with cwd set to the *workspace package* dir (`tools/asset-pipeline/`), so a
 * relative `--game ../Cultures 8th Wonder` would otherwise resolve there instead of where the user
 * typed it. Resolving against `INIT_CWD` makes the documented repo-root command work. `mod` stays a
 * bare subdir — it is always joined onto the resolved `game` ({@link resolveIniSources}).
 */
export function resolveArgs(args: Args, baseDir: string): Args {
  return { ...args, game: resolve(baseDir, args.game), out: resolve(baseDir, args.out) };
}
