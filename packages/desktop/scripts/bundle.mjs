/**
 * Bundles the desktop shell's runtime with esbuild into `dist/` (tsc only typechecks — see
 * tsconfig's emitDeclarationOnly). Bundling (instead of shipping node_modules) is what lets
 * electron-builder package the npm-workspace-symlinked pipeline + content-routes dependencies:
 * everything lands in four self-contained files plus the copied setup page statics.
 */

import { cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(packageRoot, 'dist');

/** Everything Electron provides at runtime stays external; node builtins via platform: 'node'. */
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
