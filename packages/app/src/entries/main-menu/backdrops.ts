import { fetchJsonOrNull } from '../../content/net.js';
import { diag } from '../../diag/index.js';

/**
 * The rotating menu backdrop, the bottom layer of the menu's background stack: stills captured
 * from decoded maps by `npm run menu-backdrops`, shown in a shuffled order with a slow crossfade.
 * Never throws: without `content/backdrops/` the static brand art stands.
 */

/** How long one still stays before the next crossfades in; menu.css sizes the matching push-in. */
const DWELL_MS = 14_000;

/** An array of file names; any other payload reads as absent. */
export function parseBackdropsIndex(payload: unknown): string[] | null {
  if (!Array.isArray(payload)) return null;
  const files = payload.filter((entry): entry is string => typeof entry === 'string');
  return files.length === payload.length ? files : null;
}

/** Fisher-Yates order over `count` indices; `random` injected so tests can pin the order. */
export function shuffledOrder(count: number, random: () => number): number[] {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = order[i];
    const b = order[j];
    if (a !== undefined && b !== undefined) {
      order[i] = b;
      order[j] = a;
    }
  }
  return order;
}

/**
 * Resolves once the first still is up or the degrade path has logged. The rotation timer then runs
 * for the page's lifetime: every way out of the menu is a URL navigation, which is the teardown.
 */
export async function startBackdropRotation(host: HTMLElement): Promise<void> {
  try {
    if (await boot(host)) return;
    diag.warn('content', 'menu backdrops unavailable, static backdrop stands');
  } catch (err) {
    diag.warn('content', `menu backdrops failed, static backdrop stands: ${String(err)}`);
  }
}

/** False leaves the static art standing. */
async function boot(host: HTMLElement): Promise<boolean> {
  const files = parseBackdropsIndex(await fetchJsonOrNull<unknown>('/backdrops-index'));
  if (files === null || files.length === 0) return false;

  const order = shuffledOrder(files.length, Math.random);
  const urlAt = (position: number): string => {
    const file = files[order[position % order.length] ?? 0] ?? '';
    return `/backdrops/${encodeURIComponent(file)}`;
  };

  // Walk the shuffled order until one still actually loads: a stale index entry or a half-written
  // capture must not blank the menu.
  let front = makeLayer(host);
  let back = makeLayer(host);
  let position = 0;
  for (; position < order.length; position += 1) {
    if (await showOn(front, urlAt(position))) break;
  }
  if (position === order.length) return false;

  // A single still holds the frame. Reduced motion does not stop the rotation: menu.css keeps the
  // crossfade and drops the push-in.
  if (files.length < 2) return true;

  const advance = async (): Promise<void> => {
    position += 1;
    if (await showOn(back, urlAt(position))) {
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

/** Preloads `url` before showing it; false when the load failed. */
async function showOn(layer: HTMLDivElement, url: string): Promise<boolean> {
  if (!(await preload(url))) return false;
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
