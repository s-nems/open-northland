import { bcp47Tag, localeParam, messages } from '../i18n/index.js';
import { type RouteId, routeFor } from '../routes.js';
import { BRAND_LOGO_STACKED, BRAND_LOGO_STACKED_SIZE } from './brand-art.js';
import { type CanvasReadback, canvasReadback, isBrave, webglAvailable } from './browser-support.js';
import { servedByBrowser } from './host.js';

/**
 * What a browser that cannot play properly sees before the game: a touch-only device (orders need a
 * mouse and a keyboard), no WebGL, canvas reads a privacy setting replaces, or Brave Shields left on.
 * The notice only advises, so the player can always start the game from it.
 */

/** The modes a shared link opens; developer modes never show the notice. */
const PLAYER_ROUTES: readonly RouteId[] = ['menu', 'map', 'relay'];

const DISMISSED_KEY_PREFIX = 'open-northland.device-notice.';
const DISMISSED = 'dismissed';

export type DeviceNoticeKind = 'webgl' | 'touch' | 'canvasReadback' | 'braveShields';

/** The game still plays behind these, so starting anyway once silences them; the others return until fixed. */
const DISMISSABLE: readonly DeviceNoticeKind[] = ['touch', 'braveShields'];

export interface DeviceEnv {
  readonly servedByBrowser: boolean;
  readonly playerRoute: boolean;
  readonly dismissed: ReadonlySet<DeviceNoticeKind>;
  /** `(any-pointer: coarse)`: some attached pointer is a finger. */
  readonly coarsePointer: boolean;
  /** `(any-pointer: fine)`: some attached pointer, a mouse or a trackpad, can aim precisely. */
  readonly finePointer: boolean;
  readonly webgl: boolean;
  readonly canvasReadback: CanvasReadback;
  readonly brave: boolean;
}

/**
 * The one notice to show, the gravest first. A touchscreen beside a trackpad or a mouse can play, and
 * a browser that answers neither pointer query (no pointer reported, or no support) is let through.
 */
export function deviceNotice(env: DeviceEnv): DeviceNoticeKind | null {
  if (!env.servedByBrowser || !env.playerRoute) return null;
  if (!env.webgl) return 'webgl';
  if (!env.dismissed.has('touch') && env.coarsePointer && !env.finePointer) return 'touch';
  if (env.canvasReadback === 'replaced') return 'canvasReadback';
  // Shields shift canvas reads only while on, so an exact read means the player turned them off.
  if (!env.dismissed.has('braveShields') && env.brave && env.canvasReadback === 'shifted')
    return 'braveShields';
  return null;
}

function readDismissed(): ReadonlySet<DeviceNoticeKind> {
  try {
    return new Set(
      DISMISSABLE.filter((kind) => window.localStorage.getItem(DISMISSED_KEY_PREFIX + kind) === DISMISSED),
    );
  } catch {
    return new Set();
  }
}

function rememberDismissed(kind: DeviceNoticeKind): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY_PREFIX + kind, DISMISSED);
  } catch {
    // Storage denied (private mode): the notice returns on the next visit.
  }
}

function readDeviceEnv(params: URLSearchParams): DeviceEnv {
  return {
    servedByBrowser: servedByBrowser(),
    playerRoute: PLAYER_ROUTES.includes(routeFor(params).id),
    dismissed: readDismissed(),
    coarsePointer: window.matchMedia('(any-pointer: coarse)').matches,
    finePointer: window.matchMedia('(any-pointer: fine)').matches,
    webgl: webglAvailable(),
    canvasReadback: canvasReadback(),
    brave: isBrave(),
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function mountNotice(params: URLSearchParams, kind: DeviceNoticeKind, proceed: () => void): void {
  const locale = localeParam(params);
  const notices = messages(locale).deviceNotice;
  const copy = notices[kind];
  const root = element('main', 'device-notice');
  root.lang = bcp47Tag(locale);
  const card = element('div', 'device-notice__card');
  const logo = element('img', 'device-notice__logo');
  logo.src = BRAND_LOGO_STACKED;
  logo.alt = 'Open Northland';
  logo.width = BRAND_LOGO_STACKED_SIZE.width;
  logo.height = BRAND_LOGO_STACKED_SIZE.height;
  const button = element('button', 'device-notice__proceed', copy.proceed);
  button.type = 'button';
  button.addEventListener(
    'click',
    () => {
      if (DISMISSABLE.includes(kind)) rememberDismissed(kind);
      root.remove();
      proceed();
    },
    { once: true },
  );
  card.append(
    logo,
    element('h1', 'device-notice__title', copy.title),
    element('p', 'device-notice__body', copy.body),
    button,
  );
  // A touch device needs a computer, not another browser.
  if (kind !== 'touch') card.append(element('p', 'device-notice__browser', notices.recommendedBrowser));
  root.append(card);
  document.body.append(root);
}

/** Resolves once the entry may boot: at once in a browser that can play, else when the player chooses. */
export function deviceNoticeCleared(params: URLSearchParams): Promise<void> {
  try {
    const kind = deviceNotice(readDeviceEnv(params));
    if (kind === null) return Promise.resolve();
    let proceed = (): void => undefined;
    const cleared = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    mountNotice(params, kind, proceed);
    return cleared;
  } catch {
    // A notice that cannot read the device or draw itself must not keep the game from starting.
    return Promise.resolve();
  }
}
