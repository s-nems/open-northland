/**
 * Assembles the deployable site under dist/site: the installer page, service worker, and pipeline
 * worker as self-contained browser bundles, plus the app built for the /play base.
 */

import { spawnSync } from 'node:child_process';
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { forbiddenGameExtensions } from '../../../scripts/game-asset-policy.mjs';

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
  env: { ...process.env, OPEN_NORTHLAND_BASE_PATH: BASE_PATH },
});
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

/** The deployment must carry no original game material; each visitor converts their own copy. */
async function assertNoGameAssets(dir) {
  const offenders = [];
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (forbiddenGameExtensions.has(extname(entry.name).toLowerCase())) {
      offenders.push(relative(site, join(entry.parentPath, entry.name)));
    }
  }
  if (offenders.length > 0) {
    throw new Error(`[web] site carries original game assets: ${offenders.join(', ')}`);
  }
}

await assertNoGameAssets(site);
console.log(`[web] site assembled in ${site}`);
