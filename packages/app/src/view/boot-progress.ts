import { diag } from '../diag/log.js';
import { messages } from '../i18n/index.js';
import { BRAND_BACKDROP } from './brand-art.js';

/**
 * The boot progress card a playable entry shows while it assembles a world. Plain DOM, so it draws
 * before Pixi exists and while Pixi is busy. Each entry passes the steps it actually runs, in order.
 */

/** The ordered boot steps a playable entry can report. Each is one label and one step of the bar. */
export const BOOT_PHASES = [
  'graphics',
  'map',
  'content',
  'sprites',
  'terrain',
  'objects',
  'world',
  'minimap',
  'hud',
] as const;

export type BootPhase = (typeof BOOT_PHASES)[number];

export interface BootProgress {
  /** Announce the step about to run, then yield until the browser has painted the new label and bar. */
  begin(phase: BootPhase): Promise<void>;
  /** Uncover the finished world (after one painted frame, so no black flash on the handover). */
  finish(): Promise<void>;
}

/**
 * The share of an entry's boot that is done when `phase` starts. Approximation: steps are weighted
 * equally although their real costs differ, so the bar is a coarse position in the list rather than a
 * time estimate. A phase outside `phases` reads as 0, since a mislabelled bar must not break boot.
 */
export function bootFraction(phases: readonly BootPhase[], phase: BootPhase): number {
  const index = phases.indexOf(phase);
  if (index < 0) {
    // Nothing breaks, but the bar rewinds to empty mid-boot, which is otherwise a silent mystery.
    diag.warn('boot', 'phase outside the entry step list', { phase, phases });
    return 0;
  }
  return index / phases.length;
}

let overlay: HTMLElement | null = null;

/** Cap on a paint yield, so a tab hidden after the frame was requested cannot stall the boot. */
const PAINT_TIMEOUT_MS = 250;

/**
 * Resolve once the browser has painted what was just written, since a boot step's long synchronous
 * stretch would otherwise put its own label on screen only after finishing. Boot never depends on this
 * resolving: a hidden tab fires no rAF, so it skips the yield and a mid-yield hide falls through on the
 * timeout.
 */
function nextPaint(): Promise<void> {
  if (document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    let timer = 0;
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    timer = window.setTimeout(done, PAINT_TIMEOUT_MS);
    requestAnimationFrame(() => requestAnimationFrame(done));
  });
}

function node(className: string, ...children: readonly HTMLElement[]): HTMLDivElement {
  const div = document.createElement('div');
  div.className = className;
  div.append(...children);
  return div;
}

/** Mount the card for an entry's own ordered step list. */
export function mountBootProgress(phases: readonly BootPhase[]): BootProgress {
  dismissBootProgress();
  const bar = node('boot-card__bar');
  const label = node('boot-card__label');
  const root = node('boot-card', node('boot-card__frame', node('boot-card__track', bar)), label);
  root.style.setProperty('--boot-backdrop', `url("${BRAND_BACKDROP}")`);
  // The card says what is happening, which a screen reader must hear too.
  root.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  document.body.append(root);
  overlay = root;
  return {
    async begin(phase: BootPhase): Promise<void> {
      label.textContent = messages().loading[phase];
      bar.style.width = `${bootFraction(phases, phase) * 100}%`;
      // Rides the `boot` channel into the diagnostics bundle, so a slow load is readable there.
      diag.info('boot', 'phase', { phase });
      await nextPaint();
    },
    async finish(): Promise<void> {
      // Pixi renders on rAF, so waiting a frame guarantees the world is drawn before the card comes off.
      await nextPaint();
      dismissBootProgress();
    },
  };
}

/** Remove the card if one is up. Idempotent. */
export function dismissBootProgress(): void {
  overlay?.remove();
  overlay = null;
}
