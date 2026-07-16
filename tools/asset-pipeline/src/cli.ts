#!/usr/bin/env node
/**
 * Asset pipeline CLI — offline conversion of an owned original game copy into the IR (content/).
 *
 *   npm run pipeline -- --game "../Cultures 8th Wonder" --out content
 *
 * The culturesnation mod is required: installed inside the game folder it is auto-detected;
 * unpacked elsewhere, point `--mod-root` at it (see `resolveModRoot`).
 *
 * This is run by a human/agent, not shipped. It writes no copyrighted bytes into the repo source;
 * its output goes to the gitignored content/ folder. See docs/DATA-FORMAT.md and docs/SOURCES.md.
 * The conversion itself lives in `run.ts` (`runPipeline`), shared with the desktop shell's installer.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertOutStaysInCheckout, parseArgs, resolveArgs } from './args.js';
import { runPipeline } from './run.js';

// Auto-run only when invoked as the entry point (node src/cli.ts / the dist bin), not when a test
// imports this module for parseArgs/pcxToPng/convertPcxTree.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // Resolve relative --game/--out against where `npm run` was invoked (repo root), not the workspace
  // package dir npm sets as cwd — see resolveArgs. Fall back to cwd for a bare `node dist/cli.js`.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const args = resolveArgs(parseArgs(process.argv.slice(2)), baseDir);
  // A symlinked out (a worktree sharing the primary's content/) would be clobbered in place — refuse.
  assertOutStaysInCheckout(args.out, baseDir);
  runPipeline(args).catch((err: unknown) => {
    console.error('[pipeline] failed:', err);
    process.exitCode = 1;
  });
}
