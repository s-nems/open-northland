import { defineConfig } from 'vite';

// Browser-first app shell. `npm run dev` serves this with HMR; cross-platform by construction.
// Desktop (Mac/Win/Linux) packaging via Tauri comes later (Phase 5).
export default defineConfig({
  server: { port: 5173, open: false },
  build: { target: 'es2022', outDir: 'dist' },
});
