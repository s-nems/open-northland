/**
 * Assembles the deployable site under dist/site: the installer page, service worker, and pipeline
 * worker as self-contained browser bundles, plus the app built for the /play base.
 */

import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { isForbiddenInDeployment } from '../../../scripts/game-asset-policy.mjs';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const appRoot = join(packageRoot, '../app');
const installerSetup = join(packageRoot, '../installer/src/setup');
const site = join(packageRoot, 'dist/site');

/** The public URL prefix the deployment contract fixes; the app bakes it into its asset URLs. */
const BASE_PATH = '/play';

const browserBundle = {
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'warning',
};

const appBuild = spawnSync('npx', ['vite', 'build', '--outDir', 'dist-web', '--emptyOutDir'], {
  cwd: appRoot,
  stdio: 'inherit',
  // Windows resolves npx through PATHEXT, which spawnSync does not do on its own.
  shell: process.platform === 'win32',
  env: { ...process.env, OPEN_NORTHLAND_BASE_PATH: BASE_PATH },
});
if (appBuild.error !== undefined) throw appBuild.error;
if (appBuild.status !== 0) throw new Error(`app build for ${BASE_PATH} failed`);

await rm(site, { recursive: true, force: true });
await mkdir(site, { recursive: true });
await Promise.all([
  build({
    ...browserBundle,
    entryPoints: [join(packageRoot, 'src/main.ts')],
    outfile: join(site, 'setup.js'),
  }),
  build({ ...browserBundle, entryPoints: [join(packageRoot, 'src/sw/sw.ts')], outfile: join(site, 'sw.js') }),
  build({
    ...browserBundle,
    entryPoints: [join(packageRoot, 'src/worker/pipeline-worker.ts')],
    outfile: join(site, 'pipeline-worker.js'),
  }),
  cp(join(installerSetup, 'setup.html'), join(site, 'index.html')),
  cp(join(installerSetup, 'setup.css'), join(site, 'setup.css')),
]);
await cp(join(appRoot, 'dist-web'), join(site, 'play'), { recursive: true });
// Vite's build metadata is for tooling, and nothing here reads it back.
await rm(join(site, 'play/.vite'), { recursive: true, force: true });

/**
 * The deployment must carry no original game material; each visitor converts their own copy. Every
 * entry counts, not only regular files: a symlink or a directory named like game material is a way
 * past the same rule.
 */
async function assertNoGameAssets(dir) {
  const offenders = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) continue;
    const path = relative(site, join(entry.parentPath, entry.name));
    if (isForbiddenInDeployment(entry.name)) offenders.push(path);
    else if (!entry.isFile()) offenders.push(`${path} (not a regular file)`);
  }
  if (offenders.length > 0) {
    // A rejected site must not stay on disk for `npm run web:serve` to pick up.
    await rm(site, { recursive: true, force: true });
    throw new Error(`[web] site carries original game assets: ${offenders.join(', ')}`);
  }
}

await assertNoGameAssets(site);
console.log(`[web] site assembled in ${site}`);
