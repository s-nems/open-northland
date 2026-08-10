import { fetchJsonOrNull } from '../../content/net.js';
import { diag } from '../../diag/index.js';
import {
  cachedPool,
  lastShownStill,
  parseStillList,
  rememberPool,
  rememberStill,
  stillUrl,
} from '../../view/backdrop-stills.js';
import { BRAND_BACKDROP } from '../../view/brand-art.js';

/**
 * The menu's settlement backdrop: stills captured from decoded maps by `npm run menu-backdrops`, shown
 * on the scene layer with crossfading layers above it. Never throws: without `content/backdrops/` the
 * static brand art stands.
 */

/** How long one still stays before the next crossfades in; menu.css sizes the matching push-in. */
const DWELL_MS = 14_000;

/** A still drawn at random from `pool`, never `avoid` while the pool holds anything else. */
export function randomStill(
  pool: readonly string[],
  avoid: string | null,
  random: () => number,
): string | null {
  const others = pool.filter((file) => file !== avoid);
  const choices = others.length > 0 ? others : pool;
  return choices[Math.floor(random() * choices.length)] ?? null;
}

/**
 * A Fisher-Yates order over `files` that leads with `first` while the pool still has it, so the still
 * already on the scene layer is not replaced the moment the menu opens. `random` is injected so tests
 * can pin the order.
 */
export function rotationOrder(
  files: readonly string[],
  first: string | null,
  random: () => number,
): readonly string[] {
  const order = [...files];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = order[i];
    const b = order[j];
    if (a !== undefined && b !== undefined) {
      order[i] = b;
      order[j] = a;
    }
  }
  const at = first === null ? -1 : order.indexOf(first);
  return at > 0 ? [...order.slice(at), ...order.slice(0, at)] : order;
}

/**
 * Resolves once the rotation is running or the degrade path has logged. `signal` ends the rotation,
 * which otherwise keeps swapping stills after the menu leaves for a game.
 */
export async function startBackdropRotation(host: HTMLElement, signal: AbortSignal): Promise<void> {
  try {
    const opening = await paintOpening(host);
    // A menu that left mid-boot has no backdrop to degrade, so the warning would name nothing.
    if (signal.aborted || (await boot(host, opening, signal))) return;
    diag.warn('content', 'menu backdrops unavailable, static backdrop stands');
  } catch (err) {
    diag.warn('content', `menu backdrops failed, static backdrop stands: ${String(err)}`);
  }
}

/**
 * Names the still the menu opens on before its first frame, drawn from the pool a previous visit
 * cached: with that still in the browser's cache the menu shows a settlement immediately instead of
 * swapping into one. Null leaves the static art up, and means the cache was empty or named a still
 * this capture no longer has.
 */
async function paintOpening(host: HTMLElement): Promise<string | null> {
  const opening = randomStill(cachedPool(), lastShownStill(), Math.random);
  if (opening === null) {
    setSceneArt(host, BRAND_BACKDROP);
    return null;
  }
  const url = stillUrl(opening);
  setSceneArt(host, url);
  if (await preload(url)) {
    rememberStill(opening);
    return opening;
  }
  // Drop the pool that named it, so the next launch does not open on flat colour too.
  rememberPool([]);
  setSceneArt(host, BRAND_BACKDROP);
  return null;
}

function setSceneArt(host: HTMLElement, url: string): void {
  host.style.setProperty('--menu-scene-art', `url("${url}")`);
}

/** False leaves the static art standing; an aborted menu reports true, having nothing to fall back to. */
async function boot(host: HTMLElement, opening: string | null, signal: AbortSignal): Promise<boolean> {
  const files = parseStillList(await fetchJsonOrNull<unknown>('/backdrops-index'));
  // An unreachable route says nothing about the pool; an empty one clears the cached copy.
  if (files === null) return false;
  rememberPool(files);
  if (files.length === 0) return false;

  const order = rotationOrder(files, opening, Math.random);
  const fileAt = (position: number): string => order[position % order.length] ?? '';

  // Walk the order until one still actually loads: a stale index entry or a half-written capture
  // must not blank the menu.
  let front = makeLayer(host);
  let back = makeLayer(host);
  let position = 0;
  for (; position < order.length && !signal.aborted; position += 1) {
    if (await showOn(front, fileAt(position))) break;
  }
  if (signal.aborted) return true;
  if (position === order.length) return false;

  // A single still holds the frame. Reduced motion does not stop the rotation: menu.css keeps the
  // crossfade and drops the push-in.
  if (files.length < 2) return true;

  const advance = async (): Promise<void> => {
    if (signal.aborted) return;
    position += 1;
    const shown = await showOn(back, fileAt(position));
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
async function showOn(layer: HTMLDivElement, file: string): Promise<boolean> {
  const url = stillUrl(file);
  if (!(await preload(url))) return false;
  rememberStill(file);
  // Drop the previous push-in while the layer is hidden, reflow, then restart it with the new still.
  layer.classList.remove('is-visible', 'is-zooming');
  layer.style.backgroundImage = `url("${url}")`;
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
