/**
 * Global crash capture: uncaught errors and rejections reach the log ring and raise a banner. Plain
 * DOM, so the banner depends on nothing that may itself be the wedged part.
 */
import { messages } from '../i18n/index.js';
import { isBrave } from '../view/browser-support.js';
import { downloadDiagnosticsBundle } from './bundle.js';
import { diag } from './log.js';

/** Above every game overlay; the system menu and tooltips sit at 2000. */
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

/** Created lazily so the banner copy reads the locale active at crash time. */
function showCrashBanner(text: string): void {
  if (banner === null) {
    const copy = messages().hud;
    const recommendedBrowser = messages().deviceNotice.recommendedBrowser;
    const root = document.createElement('div');
    root.style.cssText = BANNER_STYLE;
    root.setAttribute('role', 'alert');

    const title = document.createElement('strong');
    title.textContent = copy.crashTitle;
    const message = document.createElement('div');
    Object.assign(message.style, { fontFamily: 'ui-monospace,monospace', fontSize: '12px' });
    const hint = document.createElement('div');
    // Brave Shields have broken the game where every other browser ran it.
    hint.textContent = isBrave() ? `${copy.crashHint} ${copy.crashBraveHint}` : copy.crashHint;

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
    const browser = document.createElement('small');
    Object.assign(browser.style, { fontSize: '12px', opacity: '0.7' });
    browser.textContent = recommendedBrowser;
    root.append(title, message, hint, buttons, browser);
    document.body.append(root);
    banner = { root, message };
  }
  banner.message.textContent = text;
}

let installed = false;

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
