/**
 * Global crash capture: uncaught errors and rejections reach the log ring and the bug report flow,
 * whose dialog tells the player. The banner is for a passing condition, such as a short sim stall,
 * that is no bug report yet; plain DOM, so it depends on nothing that may itself be the wedged part.
 */
import { messages } from '../i18n/index.js';
import { isBrave } from '../view/platform/browser-support.js';
import { servedByBrowser } from '../view/platform/host.js';
import { downloadDiagnosticsBundle } from './bundle.js';
import {
  DEV_SERVER_FAULT_NOTE,
  devServerModuleFault,
  type IgnoredError,
  ignoredWindowError,
  thrownElsewhere,
} from './capture/foreign-error.js';
import { reportError, reportErrorOf } from './capture/report-error.js';
import { errorText } from './error-text.js';
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
  // The token with a system fallback: the banner must still read when the stylesheet never loaded.
  'font:14px/1.4 var(--font-body,ui-serif,Georgia,serif)',
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
  'cursor:var(--cursor-pointer, pointer)',
].join(';');

let banner: { readonly root: HTMLElement; readonly message: HTMLElement; cause: string } | null = null;

/** Created lazily so the banner copy reads the locale active when it shows. `cause` names the banner a
 *  later {@link dismissCrashBanner} takes down. */
export function showCrashBanner(text: string, cause: string): void {
  if (banner === null) {
    const copy = messages().hud;
    const root = document.createElement('div');
    root.style.cssText = BANNER_STYLE;
    root.setAttribute('role', 'alert');

    const title = document.createElement('strong');
    title.textContent = copy.crashTitle;
    const message = document.createElement('div');
    Object.assign(message.style, {
      fontFamily: 'ui-monospace,monospace',
      fontSize: '12px',
      userSelect: 'text',
      webkitUserSelect: 'text',
    });
    const hint = document.createElement('div');
    // Brave Shields have broken the game where every other browser ran it.
    hint.textContent = isBrave() ? `${copy.crashHint} ${copy.crashBraveHint}` : copy.crashHint;

    const download = document.createElement('button');
    download.type = 'button';
    download.textContent = copy.downloadDiagnostics;
    download.style.cssText = BANNER_BUTTON_STYLE;
    download.addEventListener('click', () => void downloadDiagnosticsBundle());

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
    // The desktop shell ships its own browser, so only the web app has one to suggest.
    if (servedByBrowser()) {
      const browser = document.createElement('small');
      Object.assign(browser.style, { fontSize: '12px', opacity: '0.7' });
      browser.textContent = messages().deviceNotice.recommendedBrowser;
      root.append(browser);
    }
    document.body.append(root);
    banner = { root, message, cause };
  }
  banner.message.textContent = text;
  banner.cause = cause;
}

/** Take down the banner while it still shows what `cause` raised. */
export function dismissCrashBanner(cause: string): void {
  if (banner === null || banner.cause !== cause) return;
  banner.root.remove();
  banner = null;
}

/** An ignored error is logged once per message, for this many messages: a script that fails every
 *  frame must not push the game's own entries out of the log. */
const IGNORED_MESSAGES_LOGGED = 20;
const ignoredLogged = new Set<string>();

/** Kept in the log as context for a later report, never reported itself. */
function noteIgnored(why: IgnoredError, message: string, source?: string): void {
  if (ignoredLogged.has(message) || ignoredLogged.size >= IGNORED_MESSAGES_LOGGED) return;
  ignoredLogged.add(message);
  const data = source === undefined ? undefined : { source };
  switch (why) {
    case 'resize-observer':
      diag.debug('crash', `ignored: ${message}`, data);
      return;
    case 'foreign':
      diag.info('crash', `ignored an error from another origin: ${message}`, data);
      return;
    case 'dev-server':
      diag.info('crash', `${DEV_SERVER_FAULT_NOTE}: ${message}`, data);
      return;
  }
}

function devServerFault(error: unknown): boolean {
  return import.meta.env.DEV && devServerModuleFault(reportErrorOf('main', error));
}

let installed = false;

export function installCrashCapture(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (event) => {
    const source = `${event.filename}:${event.lineno}:${event.colno}`;
    const message = String(event.message);
    const ignored = ignoredWindowError(
      { message, filename: event.filename, error: event.error },
      window.location.origin,
    );
    if (ignored !== null) {
      noteIgnored(ignored, message, source);
      return;
    }
    // An error event may carry no error object, only its message.
    const error: unknown = event.error ?? { name: 'Error', message };
    if (devServerFault(error)) {
      noteIgnored('dev-server', message, source);
      return;
    }
    reportError('main', error, { source });
  });
  window.addEventListener('unhandledrejection', (event) => {
    if (thrownElsewhere(event.reason, window.location.origin)) {
      noteIgnored('foreign', errorText(event.reason));
      return;
    }
    if (devServerFault(event.reason)) {
      noteIgnored('dev-server', errorText(event.reason));
      return;
    }
    reportError('main', event.reason, { facts: { unhandledRejection: true } });
  });
}
