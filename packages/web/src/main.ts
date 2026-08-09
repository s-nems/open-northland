import { initSetup } from '@open-northland/installer/setup';
import { createWebShellApi } from './web-shell.js';

/**
 * Boot for opennorthland.org/game: make sure the service worker serves the content routes, then
 * either jump straight into the game or run the shared first-run installer. `?setup` forces the
 * installer, the web counterpart of the desktop menu's reinstall entry.
 */

async function ensureServiceWorker(): Promise<void> {
  await navigator.serviceWorker.register('sw.js', { type: 'classic' });
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller === null) {
    // First visit: claim() makes this page controlled moments after activation.
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
  }
}

void (async () => {
  try {
    await ensureServiceWorker();
  } catch (err) {
    console.error('[web] service worker registration failed; content routes will 404', err);
  }
  const api = createWebShellApi();
  const forceSetup = new URLSearchParams(location.search).has('setup');
  if (!forceSetup && (await api.getState()).contentStatus === 'ready') {
    await api.startGame();
    return;
  }
  initSetup(api);
})();
