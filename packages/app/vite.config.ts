import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig, type Plugin, runnerImport } from 'vite';
import { clientBuildIdentity, refreshClientBuild } from './build/client-version.js';
import { emitVersionFile, gameVersion, restoreIdentity } from './build/game-version.js';
import { devCheckout } from './vite/dev-checkout.js';
import { serveContent } from './vite/serve-content.js';

const here = dirname(fileURLToPath(import.meta.url));
// The pipeline's output tree lives at the repo root (gitignored), outside the app's Vite root.
const contentRoot = resolve(here, '../..', process.env.ON_CONTENT_DIR ?? 'content');

/** A checkout that adds `vite/custom/plugins.ts` contributes its own plugins. */
async function checkoutPlugins(command: 'serve' | 'build'): Promise<Plugin[]> {
  const module = resolve(here, 'vite/custom/plugins.ts');
  if (!existsSync(module)) return [];
  type CheckoutPlugins = (repoRoot: string, command: 'serve' | 'build') => Promise<Plugin[]>;
  const { module: plugins } = await runnerImport<{ checkoutPlugins: CheckoutPlugins }>(module);
  return plugins.checkoutPlugins(resolve(here, '../..'), command);
}

const version = gameVersion();
const clientBuild = clientBuildIdentity(resolve(here, '../..'));
const restore = restoreIdentity(clientBuild, contentRoot);

export default defineConfig(async ({ command }) => ({
  root: here,
  resolve: { conditions: [...(command === 'serve' ? ['source'] : []), ...defaultClientConditions] },
  define: {
    __CLIENT_BUILD__: JSON.stringify(clientBuild),
    __GAME_VERSION__: JSON.stringify(version),
    __RESTORE_IDENTITY__: JSON.stringify(restore),
    // The sim's fixed-point overflow asserts run in the dev server and are compiled out of builds.
    __SIM_ASSERTS__: JSON.stringify(command === 'serve'),
  },
  plugins: [
    devCheckout(resolve(here, '../..'), contentRoot),
    serveContent(contentRoot),
    refreshClientBuild(resolve(here, '../..')),
    emitVersionFile({ version, restore }),
    ...(await checkoutPlugins(command)),
  ],
  server: { open: false },
  // `manifest` feeds scripts/bundle-report.mjs, which prints what each URL mode costs after the build.
  build: { target: 'es2022', outDir: 'dist', manifest: true },
}));
