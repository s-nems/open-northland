#!/usr/bin/env node
/**
 * Asset pipeline CLI - offline conversion of an owned original game copy into the IR (content/).
 * Run by a human or agent, never shipped: it writes no copyrighted bytes into the repo source, only
 * into the gitignored content/ folder. See docs/DATA-FORMAT.md and docs/SOURCES.md.
 */

import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { assertOutStaysInCheckout, parseArgs, resolveArgs } from './args.js';
import { runPipeline } from './run.js';

// Auto-run only when invoked as the entry point, not when a test imports this module.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  // INIT_CWD is where `npm run` was invoked; a bare `node dist/cli.js` falls back to cwd.
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const args = resolveArgs(parseArgs(process.argv.slice(2)), baseDir);
  assertOutStaysInCheckout(args.out, baseDir);
  runPipeline(args).catch((err: unknown) => {
    console.error('[pipeline] failed:', err);
    process.exitCode = 1;
  });
}
