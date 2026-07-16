import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { CULTURESNATION_MOD } from './probe.js';

export interface Args {
  game: string;
  /** The culturesnation mod overlay root (a game-root-shaped directory), or undefined to auto-detect. */
  modRoot: string | undefined;
  out: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const game = get('--game');
  if (game === undefined || get('--mod') !== undefined) {
    throw new Error(
      'usage: pipeline --game <dir> [--mod-root <dir>] [--out <dir>] — a mod installed inside the ' +
        `game folder is auto-detected (${CULTURESNATION_MOD}/); --mod-root points at a mod unpacked ` +
        'elsewhere (the former --mod <subdir> flag is gone)',
    );
  }
  return { game, modRoot: get('--mod-root'), out: get('--out') ?? 'content' };
}

/**
 * Resolves the filesystem args against `baseDir`, leaving absolute paths untouched. The entry point
 * passes `process.env.INIT_CWD` — the directory `npm run` was invoked from. npm runs a workspace
 * script with cwd set to the workspace package dir (`tools/asset-pipeline/`), so a relative
 * `--game ../Cultures 8th Wonder` would otherwise resolve there instead of where the user typed it.
 * Resolving against `INIT_CWD` makes the documented repo-root command work.
 */
export function resolveArgs(args: Args, baseDir: string): Args {
  return {
    game: resolve(baseDir, args.game),
    modRoot: args.modRoot === undefined ? undefined : resolve(baseDir, args.modRoot),
    out: resolve(baseDir, args.out),
  };
}

/**
 * Refuses an `out` that a symlink would carry outside the invoking checkout (`baseDir`). The pipeline
 * writes files through the path without clearing it, so a worktree whose gitignored `content/` is a
 * symlink to the primary checkout would silently overwrite the primary's content in place — parallel
 * worktrees must own an APFS clone instead (`cp -Rc ../open-northland/content content`; see
 * `.claude/commands/worktree.md` step 1). Only symlink escape is refused: an out that does not exist
 * yet is fine (it will be created where stated), and an explicit out elsewhere (`--out /abs/dir`)
 * is the caller's own responsibility — checked lexically, so ancestor symlinks above the checkout
 * (e.g. macOS's /var -> /private/var) don't trip it.
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
    `--out ${out} is a symlink resolving to ${realOut}, outside the invoking checkout (${baseDir}). Refusing to write through it — this would clobber another checkout's content. Replace the symlink with a copy-on-write clone (rm content && cp -Rc ../open-northland/content content), or pass the real path explicitly if writing there is intentional.`,
  );
}
