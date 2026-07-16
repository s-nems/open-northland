/**
 * Global crash capture — the tester-facing half of the diagnostics system. An uncaught exception or
 * unhandled rejection is logged to the ring (channel `crash`) and surfaces a minimal DOM banner with
 * a "download report" action. Plain DOM on purpose: the game (Pixi, the RAF loop) may be wedged, so
 * the banner depends on nothing that just crashed.
 */
import { messages } from '../i18n/index.js';
import { downloadDiagnosticsBundle } from './bundle.js';
import { diag } from './log.js';

/** Above every game overlay (system menu/tooltips sit at 2000) — a crash outranks all of them. */
const CRASH_BANNER_Z_INDEX = '2200';

const BANNER_STYLE = [
  'position:fixed',
  'top:12px',
  'left:50%',
  'transform:translateX(-50%)',
  'max-width:min(640px,90vw)',
  `z-index:${CRASH_BANNER_Z_INDEX}`,
  'display:flex',
  'flex-direction:column',
  'gap:8px',
  'padding:14px 18px',
  'background:rgba(46,16,12,0.96)',
  'color:#e8dcc0',
  'font:14px/1.4 ui-serif,Georgia,serif',
  'border:1px solid rgba(160,84,64,0.8)',
  'border-radius:8px',
  'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
].join(';');

const BANNER_BUTTON_STYLE = [
  'padding:6px 12px',
  'background:rgba(74,63,40,0.9)',
  'color:#e8dcc0',
  'font:inherit',
  'border:1px solid rgba(138,116,74,0.7)',
  'border-radius:5px',
  'cursor:pointer',
].join(';');

let banner: { readonly root: HTMLElement; readonly message: HTMLElement } | null = null;

/** Show (or update) the crash banner. Created lazily so the copy reads the by-then-active locale. */
function showCrashBanner(text: string): void {
  if (banner === null) {
    const copy = messages().hud;
    const root = document.createElement('div');
    root.style.cssText = BANNER_STYLE;
    root.setAttribute('role', 'alert');

    const title = document.createElement('strong');
    title.textContent = copy.crashTitle;
    const message = document.createElement('div');
    Object.assign(message.style, { fontFamily: 'ui-monospace,monospace', fontSize: '12px' });
    const hint = document.createElement('div');
    hint.textContent = copy.crashHint;

    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = copy.downloadDiagnostics;
    download.style.cssText = BANNER_BUTTON_STYLE;
    download.addEventListener('click', () => downloadDiagnosticsBundle());

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = copy.dismiss;
    dismiss.style.cssText = BANNER_BUTTON_STYLE;
    dismiss.addEventListener('click', () => {
      root.remove();
      banner = null;
    });

    const buttons = document.createElement('div');
    Object.assign(buttons.style, { display: 'flex', gap: '8px' });
    buttons.append(download, dismiss);
    root.append(title, message, hint, buttons);
    document.body.append(root);
    banner = { root, message };
  }
  banner.message.textContent = text;
}

let installed = false;

/**
 * Hook `window.onerror` + `unhandledrejection` once at boot — every uncaught failure lands in the
 * log ring and raises the banner. A repeating error (a throwing RAF frame) just updates the banner;
 * the bounded ring absorbs the flood.
 */
export function installCrashCapture(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (event) => {
    diag.error('crash', event.message, {
      source: `${event.filename}:${event.lineno}:${event.colno}`,
      ...(event.error instanceof Error && event.error.stack !== undefined
        ? { stack: event.error.stack }
        : {}),
    });
    showCrashBanner(event.message);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    const text = reason instanceof Error ? reason.message : String(reason);
    diag.error('crash', `unhandled rejection: ${text}`, reason instanceof Error ? reason : { reason: text });
    showCrashBanner(text);
  });
}
