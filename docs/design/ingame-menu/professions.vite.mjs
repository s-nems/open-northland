import { fileURLToPath } from 'node:url';
import { defaultClientConditions, defineConfig } from 'vite';

// Design previews import the real HUD components without starting a game session.
export default defineConfig({
  root: fileURLToPath(new URL('../../../', import.meta.url)),
  publicDir: false,
  resolve: { conditions: ['source', ...defaultClientConditions] },
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
});
