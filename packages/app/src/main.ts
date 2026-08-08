import { installCrashCapture, logBootHeader } from './diag/index.js';
import { localeParam, setActiveLocale } from './i18n/index.js';
import { routeFor } from './routes.js';
import { dismissBootProgress } from './view/boot-progress.js';

/**
 * App shell entry point: reads `window.location.search`, picks exactly one entry, and hands off. All
 * sim and render wiring lives in the entries; this file only routes.
 */
async function main(): Promise<void> {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');

  logBootHeader();
  installCrashCapture();
  const params = new URLSearchParams(window.location.search);
  setActiveLocale(localeParam(params));
  const run = await routeFor(params).load();
  return run(canvas, params);
}

// A boot that throws never reaches its own `finish()`, so the progress card would sit there for good,
// covering the crash banner.
void main().catch((err: unknown) => {
  dismissBootProgress();
  throw err; // installCrashCapture's unhandledrejection hook owns the reporting
});
