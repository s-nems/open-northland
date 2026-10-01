import { diag } from '../../diag/index.js';
import {
  lastShownStill,
  randomStill,
  rememberStill,
  BACKDROP_STILLS as STILLS,
} from '../../view/backdrop-stills.js';
import { BRAND_BACKDROP } from '../../view/brand-art.js';
import { rotationOrder } from './rotation.js';

/**
 * The menu's settlement backdrop: the bundled stills, one on the scene layer from the first frame and
 * the rest crossfading in above it. Never throws: a still that fails to load leaves the static brand
 * art standing.
 */

/** How long one still stays before the next crossfades in; menu.css sizes the matching push-in. */
const DWELL_MS = 14_000;
/** How far a still drifts during its push-in, in % of the layer; inside menu.css's 7% zoom overhang
 *  (3.5% a side), so the drift never uncovers an edge. */
const DRIFT_PERCENT = 2;

/** A still's drift as CSS percentages, in a direction drawn from `random`. */
export function backdropDrift(random: () => number): { readonly x: string; readonly y: string } {
  const angle = random() * 2 * Math.PI;
  return {
    x: `${(Math.cos(angle) * DRIFT_PERCENT).toFixed(2)}%`,
    y: `${(Math.sin(angle) * DRIFT_PERCENT).toFixed(2)}%`,
  };
}

/**
 * Resolves once the rotation is running or the degrade path has logged. `signal` ends the rotation,
 * which otherwise keeps swapping stills after the menu leaves for a game.
 */
export async function startBackdropRotation(host: HTMLElement, signal: AbortSignal): Promise<void> {
  try {
    const opening = await paintOpening(host);
    if (signal.aborted || (await rotate(host, opening, signal))) return;
    diag.warn('content', 'menu backdrops unavailable, static backdrop stands');
  } catch (err) {
    diag.warn('content', `menu backdrops failed, static backdrop stands: ${String(err)}`);
  }
}

/**
 * Names the still the menu opens on before its first frame, a different one than the last visit
 * showed: the menu appears on a settlement instead of swapping into one. Null leaves the static art
 * up, and means the still did not load.
 */
async function paintOpening(host: HTMLElement): Promise<string | null> {
  const opening = randomStill(STILLS, lastShownStill(), Math.random);
  if (opening === null) {
    setSceneArt(host, BRAND_BACKDROP);
    return null;
  }
  setSceneArt(host, opening);
  if (await preload(opening)) {
    rememberStill(opening);
    return opening;
  }
  setSceneArt(host, BRAND_BACKDROP);
  return null;
}

function setSceneArt(host: HTMLElement, url: string): void {
  host.style.setProperty('--menu-scene-art', `url("${url}")`);
}

/** False leaves the static art standing; an aborted menu reports true, having nothing to fall back to. */
async function rotate(host: HTMLElement, opening: string | null, signal: AbortSignal): Promise<boolean> {
  if (STILLS.length === 0) return false;
  const order = rotationOrder(STILLS, opening, Math.random);
  const stillAt = (position: number): string => order[position % order.length] ?? '';

  // Walk the order until one still actually loads, so one failed fetch does not blank the menu.
  let front = makeLayer(host);
  let back = makeLayer(host);
  let position = 0;
  for (; position < order.length && !signal.aborted; position += 1) {
    if (await showOn(front, stillAt(position))) break;
  }
  if (signal.aborted) return true;
  if (position === order.length) return false;

  // A single still holds the frame. Reduced motion does not stop the rotation: menu.css keeps the
  // crossfade and drops the push-in.
  if (STILLS.length < 2) return true;

  const advance = async (): Promise<void> => {
    if (signal.aborted) return;
    position += 1;
    const shown = await showOn(back, stillAt(position));
    if (signal.aborted) return;
    if (shown) {
      front.classList.remove('is-visible');
      [front, back] = [back, front];
    }
    window.setTimeout(() => void advance(), DWELL_MS);
  };
  window.setTimeout(() => void advance(), DWELL_MS);
  return true;
}

function makeLayer(host: HTMLElement): HTMLDivElement {
  const layer = document.createElement('div');
  layer.className = 'main-menu__backdrop';
  host.append(layer);
  return layer;
}

/** Preloads the still, records it as the one on screen, and shows it; false when the load failed. */
async function showOn(layer: HTMLDivElement, url: string): Promise<boolean> {
  if (!(await preload(url))) return false;
  rememberStill(url);
  // Drop the previous push-in while the layer is hidden, reflow, then restart it with the new still.
  layer.classList.remove('is-visible', 'is-zooming');
  layer.style.backgroundImage = `url("${url}")`;
  const drift = backdropDrift(Math.random);
  layer.style.setProperty('--drift-x', drift.x);
  layer.style.setProperty('--drift-y', drift.y);
  void layer.offsetWidth;
  layer.classList.add('is-visible', 'is-zooming');
  return true;
}

function preload(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}
