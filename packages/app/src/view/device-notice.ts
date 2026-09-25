import { bcp47Tag, localeParam, messages } from '../i18n/index.js';
import { type RouteId, routeFor } from '../routes.js';
import { BRAND_LOGO_STACKED, BRAND_LOGO_STACKED_SIZE } from './brand-art.js';
import { canvasReadbackIntact, webglAvailable } from './browser-support.js';
import { servedByBrowser } from './host.js';

/**
 * What a browser that cannot play properly sees before the game: a touch-only device (orders need a
 * mouse and a keyboard), no WebGL, or canvas reads a privacy setting alters. The notice only advises,
 * so the player can always start the game from it.
 */

/** The modes a shared link opens; developer modes never show the notice. */
const PLAYER_ROUTES: readonly RouteId[] = ['menu', 'map', 'relay'];

const DISMISSED_KEY = 'open-northland.device-notice';
const DISMISSED = 'dismissed';

export type DeviceNoticeKind = 'webgl' | 'touch' | 'canvasReadback';

export interface DeviceEnv {
  readonly servedByBrowser: boolean;
  readonly playerRoute: boolean;
  /** The player started anyway from the touch notice once; the other notices return until fixed. */
  readonly touchDismissed: boolean;
  /** `(any-pointer: coarse)`: some attached pointer is a finger. */
  readonly coarsePointer: boolean;
  /** `(any-pointer: fine)`: some attached pointer, a mouse or a trackpad, can aim precisely. */
  readonly finePointer: boolean;
  readonly webgl: boolean;
  readonly canvasReadbackIntact: boolean;
}

/**
 * The one notice to show, the gravest first. A touchscreen beside a trackpad or a mouse can play, and
 * a browser that answers neither pointer query (no pointer reported, or no support) is let through.
 */
export function deviceNotice(env: DeviceEnv): DeviceNoticeKind | null {
  if (!env.servedByBrowser || !env.playerRoute) return null;
  if (!env.webgl) return 'webgl';
  if (!env.touchDismissed && env.coarsePointer && !env.finePointer) return 'touch';
  if (!env.canvasReadbackIntact) return 'canvasReadback';
  return null;
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === DISMISSED;
  } catch {
    return false;
  }
}

function rememberDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, DISMISSED);
  } catch {
    // Storage denied (private mode): the notice returns on the next visit.
  }
}

function readDeviceEnv(params: URLSearchParams): DeviceEnv {
  return {
    servedByBrowser: servedByBrowser(),
    playerRoute: PLAYER_ROUTES.includes(routeFor(params).id),
    touchDismissed: readDismissed(),
    coarsePointer: window.matchMedia('(any-pointer: coarse)').matches,
    finePointer: window.matchMedia('(any-pointer: fine)').matches,
    webgl: webglAvailable(),
    canvasReadbackIntact: canvasReadbackIntact(),
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
  const copy = messages(locale).deviceNotice[kind];
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
      if (kind === 'touch') rememberDismissed();
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
