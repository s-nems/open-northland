import { formatMessage, messages, setActiveLocale } from '@open-northland/installer/i18n';
import { initSetup, showSetupBlocked } from '@open-northland/installer/setup';
import { effectiveLocale } from './locale.js';
import { assertStorageAvailable } from './storage.js';
import { createWebShellApi } from './web-shell.js';

/**
 * Boot for game.opennorthland.org: make sure the service worker serves the content routes, then
 * either jump straight into the game or run the shared first-run installer. `?setup` forces the
 * installer, the web counterpart of the desktop menu's reinstall entry.
 */

/** How long a page waits to become controlled before treating the worker as unusable. */
const CONTROL_TIMEOUT_MS = 5000;

/** One reload is allowed to recover an uncontrolled navigation; this remembers that it was spent. */
const RELOAD_KEY = 'open-northland.sw-reload';

/**
 * A browser that refuses service workers by policy neither rejects nor resolves: `register` and
 * `ready` simply never settle. The whole handshake is therefore bounded rather than each await, and
 * a rejection is the same answer as a timeout.
 */
function controlledWithin(timeoutMs: number): Promise<boolean> {
  const handshake = (async () => {
    await navigator.serviceWorker.register('sw.js', { type: 'classic' });
    await navigator.serviceWorker.ready;
    if (navigator.serviceWorker.controller !== null) return true;
    await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    });
    return true;
  })().catch(() => false);
  const expiry = new Promise<boolean>((resolve) => {
    window.setTimeout(() => resolve(false), timeoutMs);
  });
  return Promise.race([handshake, expiry]);
}

/**
 * A hard reload, or a navigation that bypassed the worker, leaves the page uncontrolled with an
 * already-activated worker that will never fire `controllerchange`. Reloading once puts the
 * navigation back through the worker; a second failure means the browser is not going to allow one.
 */
async function ensureContentRoutes(): Promise<void> {
  if (!('serviceWorker' in navigator)) throw new Error(messages().errors.noServiceWorker);
  if (await controlledWithin(CONTROL_TIMEOUT_MS)) {
    sessionStorage.removeItem(RELOAD_KEY);
    return;
  }
  if (sessionStorage.getItem(RELOAD_KEY) !== null) throw new Error(messages().errors.noServiceWorker);
  sessionStorage.setItem(RELOAD_KEY, '1');
  location.reload();
  // The document is being replaced; nothing after this may run.
  return new Promise<void>(() => {});
}

async function boot(): Promise<void> {
  setActiveLocale(effectiveLocale());
  assertStorageAvailable();
  await ensureContentRoutes();
  const api = createWebShellApi();
  const forceSetup = new URLSearchParams(location.search).has('setup');
  if (!forceSetup && (await api.getState()).contentStatus === 'ready') {
    await api.startGame();
    return;
  }
  initSetup(api);
}

void boot().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  showSetupBlocked(formatMessage(messages().errors.setupFailed, { message }));
});
