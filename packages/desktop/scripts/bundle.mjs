/**
 * electron-builder ships only `dist/**`, `package.json` and the external dependencies below, so every
 * workspace-symlinked dependency must be inlined here; `tsc` emits declarations only.
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
  // Electron is provided by the runtime; koffi loads a native binary beside its own files, so it ships as
  // a real dependency and `stage-native.mjs` adds the binary of each packaged platform.
  external: ['electron', 'koffi'],
  sourcemap: true,
  logLevel: 'warning',
  // The sandboxed preload can require nothing but `electron`, so it is bundled whole as well.
  entryPoints: [join(packageRoot, 'src/main.ts'), join(packageRoot, 'src/preload.ts')],
  outdir: join(packageRoot, 'dist'),
  outExtension: { '.js': '.cjs' },
});
