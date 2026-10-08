import type { RouteId } from '../routes.js';

/**
 * Owns this document's history and keeps a browser accident from ending a running game: while a game
 * holds the document, a history traversal lands on a trap entry the game pushes back, the browser's
 * reload, history and zoom keys are cancelled where a page may, and leaving asks the player first.
 * Without a game, a traversal reloads, so a URL reached that way boots the way a typed one does.
 *
 * Chromium's back button skips entries a page added without a user gesture, so the trap waits for the
 * player's first gesture in the game, and a run of presses that never touches the game ends at the
 * leave prompt rather than in the menu.
 */

/** Entries whose document holds a game the player would lose; the rest reload for free. */
const GAME_ROUTES: ReadonlySet<RouteId> = new Set<RouteId>(['map', 'relay']);

/** `MouseEvent.button` of the mice's browser buttons. */
const BACK_BUTTON = 3;
const FORWARD_BUTTON = 4;

let held = false;
/** The trap entry is owed and goes in with the next gesture. */
let trapPending = false;
/** The held game's current address: what a traversal gets pushed back to. */
let heldHref = '';
/** Set once this document swapped entries; only then does a traversal have an in-document target. */
let swapped = false;
let installed = false;
let reloadPage = (): void => window.location.reload();

export function routeHoldsGame(route: RouteId): boolean {
  return GAME_ROUTES.has(route);
}

/** The entry the document runs changed; holds the document for a game route and frees it for others. */
export function guardEntry(route: RouteId): void {
  const next = routeHoldsGame(route);
  if (next) heldHref = window.location.href;
  if (next === held) return;
  held = next;
  trapPending = held;
}

/** The trap: a back traversal lands on the game's own entry, same document, same URL. */
function onGesture(): void {
  if (!trapPending) return;
  trapPending = false;
  window.history.pushState(null, '', heldHref);
}

/** The document is leaving on purpose: no trap, no prompt. */
export function releaseDocument(): void {
  held = false;
  trapPending = false;
}

/** A reload the player or the app asked for; the game it ends is not an accident. */
export function reloadDocument(): void {
  releaseDocument();
  reloadPage();
}

/** Hands the document's address to the entry about to run in it; `swapToEntry` owns the handover. */
export function pushEntryUrl(search: string): void {
  window.history.pushState(null, '', search);
  swapped = true;
}

/** Rewrites the running entry's address in place, so a traversal comes back to the rewritten one. */
export function replaceEntryUrl(url: string | URL): void {
  window.history.replaceState(window.history.state, '', url);
  if (held) heldHref = window.location.href;
}

/** Keys that leave the game inside the browser: history, reload, zoom. Text fields keep their own. */
export function isBrowserShortcut(e: KeyboardEvent, editing: boolean): boolean {
  const command = e.ctrlKey || e.metaKey;
  const arrow = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
  if (arrow && e.altKey && !command) return !editing;
  if (arrow && e.metaKey && !e.ctrlKey && !editing) return true;
  if (e.metaKey && !e.ctrlKey && (e.key === '[' || e.key === ']')) return true;
  if (e.key === 'Backspace' && !editing && !command) return true;
  if (e.key === 'F5') return true;
  if (command && !e.altKey && e.key.toLowerCase() === 'r') return true;
  return command && isZoomKey(e);
}

function isZoomKey(e: KeyboardEvent): boolean {
  if (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract' || e.code === 'Numpad0') return true;
  return e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_' || e.key === '0';
}

function isEditing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target.isContentEditable
  );
}

/** A browser driven by automation leaves on purpose; a prompt would only block its run. */
function automated(): boolean {
  return navigator.webdriver;
}

function onPopState(): void {
  if (held) window.history.pushState(null, '', heldHref);
  else if (swapped) reloadPage();
}

function onMouseUp(e: MouseEvent): void {
  if (held && (e.button === BACK_BUTTON || e.button === FORWARD_BUTTON)) e.preventDefault();
}

function onKeyDown(e: KeyboardEvent): void {
  onGesture();
  if (held && isBrowserShortcut(e, isEditing(e.target))) e.preventDefault();
}

/** Ctrl with the wheel, which a trackpad pinch also sends, is the browser's zoom; the HUD never scales that way. */
function onWheel(e: WheelEvent): void {
  if (held && e.ctrlKey) e.preventDefault();
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  if (!held || automated()) return;
  e.preventDefault();
  // The legacy spelling; the browser shows its own wording either way.
  e.returnValue = '';
}

function onDrag(e: DragEvent): void {
  e.preventDefault();
}

/** Installs the guard once per document; `guardEntry` turns the game part on and off. */
export function installNavigationGuard(reload: () => void = reloadPage): () => void {
  if (installed) return () => undefined;
  installed = true;
  reloadPage = reload;
  const controller = new AbortController();
  const { signal } = controller;
  window.addEventListener('popstate', onPopState, { signal });
  window.addEventListener('pointerdown', onGesture, { capture: true, signal });
  window.addEventListener('mouseup', onMouseUp, { capture: true, signal });
  window.addEventListener('auxclick', onMouseUp, { capture: true, signal });
  window.addEventListener('keydown', onKeyDown, { capture: true, signal });
  window.addEventListener('wheel', onWheel, { capture: true, passive: false, signal });
  window.addEventListener('beforeunload', onBeforeUnload, { signal });
  window.addEventListener('dragover', onDrag, { signal });
  window.addEventListener('drop', onDrag, { signal });
  return () => {
    controller.abort();
    installed = false;
  };
}
