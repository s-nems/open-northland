/**
 * electron-builder ships only `dist/**` and `package.json`, so every workspace-symlinked dependency
 * must be inlined here; `tsc` emits declarations only.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

await build({
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // Electron is provided by the runtime.
  external: ['electron'],
  sourcemap: true,
  logLevel: 'warning',
  entryPoints: [join(packageRoot, 'src/main.ts')],
  outfile: join(packageRoot, 'dist/main.cjs'),
});
