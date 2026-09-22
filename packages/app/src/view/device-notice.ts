import { bcp47Tag, localeParam, messages } from '../i18n/index.js';
import { type RouteId, routeFor } from '../routes.js';
import { BRAND_LOGO_STACKED, BRAND_LOGO_STACKED_SIZE } from './brand-art.js';
import { servedByBrowser } from './host.js';

/**
 * What a touch-only browser sees before the game: orders need a mouse (right click, drag select,
 * hover) and a keyboard. The notice only advises, so the player can always start the game from it.
 */

/** The modes a shared link opens; developer modes never show the notice. */
const PLAYER_ROUTES: readonly RouteId[] = ['menu', 'map', 'relay'];

const DISMISSED_KEY = 'open-northland.device-notice';
const DISMISSED = 'dismissed';

export interface DeviceEnv {
  readonly servedByBrowser: boolean;
  readonly playerRoute: boolean;
  readonly dismissed: boolean;
  /** `(any-pointer: coarse)`: some attached pointer is a finger. */
  readonly coarsePointer: boolean;
  /** `(any-pointer: fine)`: some attached pointer, a mouse or a trackpad, can aim precisely. */
  readonly finePointer: boolean;
}

/**
 * Only a finger to point with. A touchscreen beside a trackpad or a mouse can play, and a browser that
 * answers neither query (no pointer reported, or no support) boots straight into the game.
 */
export function deviceNoticeNeeded(env: DeviceEnv): boolean {
  return env.servedByBrowser && env.playerRoute && !env.dismissed && env.coarsePointer && !env.finePointer;
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
    dismissed: readDismissed(),
    coarsePointer: window.matchMedia('(any-pointer: coarse)').matches,
    finePointer: window.matchMedia('(any-pointer: fine)').matches,
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

function mountNotice(params: URLSearchParams, proceed: () => void): void {
  const locale = localeParam(params);
  const copy = messages(locale).deviceNotice;
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
      rememberDismissed();
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

/** Resolves once the entry may boot: at once on a device that can play, else when the player chooses. */
export function deviceNoticeCleared(params: URLSearchParams): Promise<void> {
  try {
    if (!deviceNoticeNeeded(readDeviceEnv(params))) return Promise.resolve();
    let proceed = (): void => undefined;
    const cleared = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    mountNotice(params, proceed);
    return cleared;
  } catch {
    // A notice that cannot read the device or draw itself must not keep the game from starting.
    return Promise.resolve();
  }
}
