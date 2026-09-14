import { realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { CULTURESNATION_MOD } from './mod-root.js';

export interface Args {
  /** The unpacked culturesnation mod, the conversion's only input. */
  modRoot: string;
  /** Explicit release label from the installed mod package; absent means unknown. */
  modVersion?: string;
  out: string;
}

export function parseArgs(argv: readonly string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const modRoot = get('--mod-root');
  if (modRoot === undefined) {
    throw new Error(
      'usage: pipeline --mod-root <dir> [--mod-version <version>] [--out <dir>] - the unpacked ' +
        `culturesnation mod (the directory holding ${CULTURESNATION_MOD}/) is the only input; a game ` +
        'folder with the mod installed inside it works as --mod-root too.',
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
    modRoot,
    out: get('--out') ?? 'content',
    ...(modVersion === undefined ? {} : { modVersion }),
  };
}

/**
 * Resolves the filesystem args against `baseDir`, leaving absolute paths untouched. The entry point
 * passes `process.env.INIT_CWD`: npm runs a workspace script with cwd set to `tools/asset-pipeline/`,
 * so a relative `--mod-root ../CNMod-1.3.2` would otherwise resolve there instead of the repo root.
 */
export function resolveArgs(args: Args, baseDir: string): Args {
  return {
    ...args,
    modRoot: resolve(baseDir, args.modRoot),
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
