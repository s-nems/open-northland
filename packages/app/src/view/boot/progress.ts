import { diag } from '../../diag/log.js';
import { messages } from '../../i18n/index.js';
import { nextPaint } from '../next-paint.js';
import { readStoredSettings } from '../settings/store.js';
import { BACKDROP_STILLS, lastShownStill, randomStill, rememberStill } from './backdrop-stills.js';
import { BRAND_BACKDROP } from './brand-art.js';
import { loadingTipPanel } from './loading-tips.js';

/**
 * The boot progress card a playable entry shows while it assembles a world. Plain DOM, so it draws
 * before Pixi exists and while Pixi is busy.
 */

/** The ordered boot steps a playable entry can report; an entry passes the ones it actually runs. */
export const BOOT_PHASES = [
  'verify',
  'graphics',
  'map',
  'content',
  'sprites',
  'terrain',
  'objects',
  'world',
  'minimap',
  'shaders',
  'nightShaders',
  'hud',
  'players',
] as const;

export type BootPhase = (typeof BOOT_PHASES)[number];

export interface BootProgress {
  /** Announce the step about to run, then yield until the browser has painted the new label and bar. */
  begin(phase: BootPhase): Promise<void>;
  /** Uncover the finished world (after one painted frame, so no black flash on the handover). */
  finish(): Promise<void>;
}

/**
 * The share of an entry's boot that is done when `phase` starts. Steps are weighted equally although
 * their real costs differ, so the bar is a coarse position in the list rather than a time estimate. A
 * phase outside `phases` reads as 0, since a mislabelled bar must not break boot.
 */
export function bootFraction(phases: readonly BootPhase[], phase: BootPhase): number {
  const index = phases.indexOf(phase);
  if (index < 0) {
    diag.warn('boot', 'phase outside the entry step list', { phase, phases });
    return 0;
  }
  return index / phases.length;
}

let overlay: HTMLElement | null = null;
/** The game view may already run under the card; its keys must not act on a world nobody sees. */
const KEY_EVENTS = ['keydown', 'keyup'] as const;
const swallowKey = (event: KeyboardEvent): void => event.stopImmediatePropagation();

/** A still as a CSS `<bg-image>`, or `none` when the pool has none. */
export function bootStillImage(still: string | null): string {
  return still === null ? 'none' : `url("${still}")`;
}

/** A random still for this load, never the one shown last, remembered so the next screen differs too. */
function pickBootStill(): string | null {
  const still = randomStill(BACKDROP_STILLS, lastShownStill(), Math.random);
  if (still !== null) rememberStill(still);
  return still;
}

function node(className: string, ...children: readonly HTMLElement[]): HTMLDivElement {
  const div = document.createElement('div');
  div.className = className;
  div.append(...children);
  return div;
}

/** Mount the card for an entry's own ordered step list; `onProgress` hears each step's start fraction.
 *  A card mounted over one already up keeps its still, so a boot handed between two step lists does
 *  not flash another picture. */
export function mountBootProgress(
  phases: readonly BootPhase[],
  onProgress?: (fraction: number) => void,
): BootProgress {
  const still = overlay?.style.getPropertyValue('--boot-still') || bootStillImage(pickBootStill());
  dismissBootProgress();
  const bar = node('boot-card__bar');
  const label = node('boot-card__label');
  const root = node('boot-card', node('boot-card__frame', node('boot-card__track', bar)), label);
  root.style.setProperty('--boot-backdrop', `url("${BRAND_BACKDROP}")`);
  root.style.setProperty('--boot-still', still);
  root.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const tip = loadingTipPanel(readStoredSettings().keyBindings);
  if (tip !== null) root.append(tip);
  document.body.append(root);
  overlay = root;
  for (const kind of KEY_EVENTS) window.addEventListener(kind, swallowKey, { capture: true });
  return {
    async begin(phase: BootPhase): Promise<void> {
      label.textContent = messages().loading[phase];
      const fraction = bootFraction(phases, phase);
      bar.style.width = `${fraction * 100}%`;
      onProgress?.(fraction);
      diag.info('boot', 'phase', { phase });
      await nextPaint();
    },
    async finish(): Promise<void> {
      await nextPaint();
      dismissBootProgress();
    },
  };
}

export interface BootNoticeAction {
  readonly label: string;
  readonly onClick: () => void;
}

/** A boot that cannot go on, said on the card's own backdrop: a carved notice and its ways out. Returns
 *  what removes it. */
export function mountBootNotice(
  title: string,
  detail: string,
  actions: readonly BootNoticeAction[],
): () => void {
  const heading = node('boot-notice__heading');
  heading.textContent = title;
  const text = node('boot-notice__text');
  text.textContent = detail;
  const buttons = actions.map((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'boot-notice__button';
    button.textContent = action.label;
    button.addEventListener('click', action.onClick);
    return button;
  });
  const notice = node('boot-notice', heading, text, ...buttons);
  notice.setAttribute('role', 'alert');
  const root = node('boot-card', notice);
  root.style.setProperty('--boot-backdrop', `url("${BRAND_BACKDROP}")`);
  root.style.setProperty('--boot-still', bootStillImage(lastShownStill()));
  document.body.append(root);
  buttons[0]?.focus({ preventScroll: true });
  return () => root.remove();
}

/** Whether a boot's progress card is up: the page is loading a world, not running one. */
export function bootCardShown(): boolean {
  return overlay !== null;
}

/** Remove the card if one is up. Idempotent. */
export function dismissBootProgress(): void {
  if (overlay !== null) {
    for (const kind of KEY_EVENTS) window.removeEventListener(kind, swallowKey, { capture: true });
  }
  overlay?.remove();
  overlay = null;
}
