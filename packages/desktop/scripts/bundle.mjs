/**
 * electron-builder ships only `dist/**` and `package.json`, so the workspace-symlinked pipeline and
 * content-resolver dependencies must be inlined here; `tsc` emits declarations only.
 */

import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(packageRoot, 'dist');

/** Electron is provided by the runtime, so it stays external. */
const nodeBundle = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
};

await mkdir(join(dist, 'renderer'), { recursive: true });
await Promise.all([
  build({ ...nodeBundle, entryPoints: [join(packageRoot, 'src/main.ts')], outfile: join(dist, 'main.cjs') }),
  build({
    ...nodeBundle,
    entryPoints: [join(packageRoot, 'src/preload.ts')],
    outfile: join(dist, 'preload.cjs'),
  }),
  build({
    ...nodeBundle,
    entryPoints: [join(packageRoot, 'src/pipeline-child.ts')],
    outfile: join(dist, 'pipeline-child.cjs'),
  }),
  build({
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
    logLevel: 'warning',
    entryPoints: [join(packageRoot, 'src/setup/setup.ts')],
    outfile: join(dist, 'renderer/setup.js'),
  }),
  cp(join(packageRoot, 'src/setup/setup.html'), join(dist, 'renderer/setup.html')),
  cp(join(packageRoot, 'src/setup/setup.css'), join(dist, 'renderer/setup.css')),
]);
