import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { CULTURESNATION_MOD } from './probe.js';

export interface Args {
  game: string;
  /** The culturesnation mod overlay root (a game-root-shaped directory), or undefined to auto-detect. */
  modRoot: string | undefined;
  /** Explicit release label from the installed mod package; absent means unknown. */
  modVersion?: string;
  out: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const game = get('--game');
  if (game === undefined) {
    throw new Error(
      'usage: pipeline --game <dir> [--mod-root <dir>] [--mod-version <version>] [--out <dir>] - a mod installed inside the ' +
        `game folder is auto-detected (${CULTURESNATION_MOD}/); --mod-root points at a mod unpacked ` +
        'elsewhere',
    );
  }
  const modVersion = get('--mod-version');
  if (
    argv.includes('--mod-version') &&
    (modVersion === undefined ||
      modVersion.startsWith('--') ||
      modVersion.trim().length === 0 ||
      modVersion.length > 128)
  ) {
    throw new Error('--mod-version requires a nonempty release label of at most 128 characters');
  }
  return {
    game,
    modRoot: get('--mod-root'),
    out: get('--out') ?? 'content',
    ...(modVersion === undefined ? {} : { modVersion }),
  };
}

/**
 * Resolves the filesystem args against `baseDir`, leaving absolute paths untouched. The entry point
 * passes `process.env.INIT_CWD`: npm runs a workspace script with cwd set to `tools/asset-pipeline/`,
 * so a relative `--game ../Cultures 8th Wonder` would otherwise resolve there instead of the repo root.
 */
export function resolveArgs(args: Args, baseDir: string): Args {
  return {
    ...args,
    game: resolve(baseDir, args.game),
    modRoot: args.modRoot === undefined ? undefined : resolve(baseDir, args.modRoot),
    out: resolve(baseDir, args.out),
  };
}

/**
 * Refuses an `out` under `baseDir` that a symlink carries outside it: the pipeline writes files
 * through the path, so a worktree whose gitignored `content/` is a symlink to another checkout would
 * silently overwrite that checkout's content in place. Only symlink escape is refused, and the check
 * is lexical so ancestor symlinks above the checkout (macOS's /var -> /private/var) don't trip it.
 */
export function assertOutStaysInCheckout(out: string, baseDir: string): void {
  const lexBase = resolve(baseDir);
  const lexOut = resolve(out);
  if (lexOut !== lexBase && !lexOut.startsWith(lexBase + sep)) return;
  let realOut: string;
  try {
    realOut = realpathSync(lexOut);
  } catch {
    return;
  }
  const realBase = realpathSync(lexBase);
  if (realOut === realBase || realOut.startsWith(realBase + sep)) return;
  throw new Error(
    `--out ${out} is a symlink resolving to ${realOut}, outside the invoking checkout (${baseDir}). Refusing to write through it - this would clobber another checkout's content. Replace the symlink with a copy-on-write clone (rm content && cp -Rc ../open-northland/content content), or pass the real path explicitly if writing there is intentional.`,
  );
}
