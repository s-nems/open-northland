// Shared plumbing for the benchmark entry points (docs/TESTING.md "Benchmarks and long runs").
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, resolve, sep } from 'node:path';
import { repoRoot } from './content-dir.mjs';

/** Where `packages/app/tsconfig.bench.json` compiles the benchmark programs to. */
const BENCH_PROGRAM_DIR = 'packages/app/dist/bench';
// `spawnSync` resolves no PATHEXT and Node refuses to spawn Windows' `npx.cmd` directly, so `npx` is
// only reachable there through a shell. Every argument below is an internal literal.
const NEEDS_SHELL = process.platform === 'win32';

/**
 * Every workspace package resolves through its `exports` to `dist`, so a run that skipped this would
 * measure the previous build. Outputs are deleted rather than built over: `tsc --build` never removes
 * an output whose source is gone, so a rename would otherwise leave an orphan in a tree that still
 * looks current.
 */
export function rebuildWorkspace() {
  for (const { outDir, buildInfo } of tscProjects()) {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(buildInfo, { force: true });
  }
  console.log('bench: rebuilding the workspace so the report describes the working tree');
  const built = spawnSync('npx', ['tsc', '--build'], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
    shell: NEEDS_SHELL,
  });
  if (built.status !== 0) {
    console.error('bench: the workspace build failed, so there is nothing current to measure.');
    process.exit(built.status ?? 1);
  }
}

/** The outputs `tsc --build` owns, read from each project's own `outDir`: `packages/desktop/dist` is
 *  esbuild's bundle, and only its `dist-types` half belongs to tsc. The sweep deletes recursively, so
 *  an `outDir` that does not stay under its project is rejected rather than followed. */
function tscProjects() {
  const solution = JSON.parse(readFileSync(resolve(repoRoot, 'tsconfig.json'), 'utf8'));
  return solution.references.map(({ path }) => {
    // A reference names either a directory or the config file itself (`packages/app` carries two).
    const resolved = resolve(repoRoot, path);
    const config = resolved.endsWith('.json') ? resolved : resolve(resolved, 'tsconfig.json');
    const dir = dirname(config);
    const { compilerOptions } = JSON.parse(readFileSync(config, 'utf8'));
    const outDir = resolve(dir, compilerOptions?.outDir ?? '');
    if (!outDir.startsWith(dir + sep)) {
      throw new Error(`${path} must declare an outDir below itself, not '${outDir}'`);
    }
    return { outDir, buildInfo: config.replace(/\.json$/, '.tsbuildinfo') };
  });
}

/** Runs one compiled benchmark program and exits with its status. */
export function runBenchProgram(name, env = process.env) {
  const program = resolve(repoRoot, BENCH_PROGRAM_DIR, `${name}.js`);
  if (!existsSync(program)) {
    console.error(`bench: ${basename(program)} is not built - run 'npx tsc --build' first.`);
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [program], { stdio: 'inherit', cwd: repoRoot, env });
  process.exit(result.status ?? 1);
}
