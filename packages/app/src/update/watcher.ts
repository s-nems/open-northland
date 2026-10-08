import { DEV_GAME_VERSION, GAME_VERSION, RESTORE_IDENTITY } from '../build-version.js';
import { diag } from '../diag/index.js';
import { formatMessage, messages } from '../i18n/index.js';
import { routeFor } from '../routes.js';
import { servedByBrowser } from '../view/host.js';
import { releaseDocument, reloadDocument } from '../view/navigation-guard.js';
import { type BannerAction, hideUpdateBanner, setUpdateBannerText, showUpdateBanner } from './banner.js';
import {
  type CheckCause,
  isStaleCodeError,
  menuSearch,
  parseServedBuild,
  placeOfRoute,
  type ServedBuild,
  type UpdateOffer,
  type UpdatePlace,
  updateOffer,
} from './model.js';

/**
 * Notices a deploy from an open web tab. The host rewrites `version.json` on every release and drops
 * the previous build's `/assets/`, so an outdated tab fails on its next chunk or reads content its code
 * does not know. The desktop build ships its own files and a `dev` build has no release to compare.
 */

const VERSION_URL = '/version.json';
const ROUTINE_CHECK_MS = 5 * 60_000;
/** A tab flipped back and forth checks once, not on every flip. */
const MIN_ROUTINE_GAP_MS = 30_000;
/** A relay can close before the new page is served; these re-ask after it, before giving up. */
const RELAY_RESTART_RETRY_MS: readonly number[] = [3000, 10_000];
const COUNTDOWN_SECONDS = 10;
/** Long enough to read why the page is about to go. */
const RELOAD_NOTICE_MS = 3000;
const MS_PER_SECOND = 1000;
/** The build this tab last reloaded itself for. Never cleared: a host still serving the old page, or
 *  replicas of two builds, would otherwise reload the tab over and over. */
const RELOADED_FOR_KEY = 'open-northland.update-reloaded-for';

/** Stages a running local game for the next boot to resume; the reload follows. */
export type UpdateContinuation = () => Promise<void>;

let continuation: UpdateContinuation | null = null;
/** Relay links that sit in a room: the page is a relayed game wherever its URL points. */
const relayRooms = new Set<() => boolean>();
let runningBuild: string | null = null;
let checking = false;
/** A relay restart that arrived during another check; it runs once that one ends. */
let pendingRelayRestart = false;
let lastRoutineAt = Number.NEGATIVE_INFINITY;
/** Offers the player closed stay closed until the next routine check. */
let quietUntil = Number.NEGATIVE_INFINITY;
/** Set once the page is on its way out, so no later check replaces the notice saying so. */
let leaving = false;
let shown: UpdateOffer['kind'] | null = null;
let countdown: ReturnType<typeof setInterval> | null = null;

/** A local game registers while it runs; null when it ends, which takes down an offer to carry it. */
export function setUpdateContinuation(next: UpdateContinuation | null): void {
  continuation = next;
  if (next === null && shown === 'continue') {
    stopCountdown();
    hideUpdateBanner();
    shown = null;
  }
}

/** A relay link registers whether it holds a room; the returned call ends the registration. */
export function holdRelayPlace(inRoom: () => boolean): () => void {
  relayRooms.add(inRoom);
  return () => {
    relayRooms.delete(inRoom);
  };
}

export function installUpdateWatcher(): void {
  if (runningBuild !== null || GAME_VERSION === DEV_GAME_VERSION || !servedByBrowser()) return;
  runningBuild = pageEntryScript();
  if (runningBuild === null) return;
  requestUpdateCheck('routine');
  setInterval(() => requestUpdateCheck('routine'), ROUTINE_CHECK_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestUpdateCheck('routine');
  });
  // A tab restored from the back-forward cache runs the code it had, whatever the host serves now.
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) requestUpdateCheck('routine');
  });
  window.addEventListener('vite:preloadError', () => requestUpdateCheck('staleCode'));
  window.addEventListener('error', (event) => {
    if (isStaleCodeError(event.message)) requestUpdateCheck('staleCode');
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    if (isStaleCodeError(reason instanceof Error ? reason.message : String(reason)))
      requestUpdateCheck('staleCode');
  });
}

/** The entry script `index.html` loaded, as `version.json` names its build. */
function pageEntryScript(): string | null {
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script === null ? null : new URL(script.src).pathname;
}

/** Asks the host what it serves and tells the player when that is another build. Quiet on failure. */
export function requestUpdateCheck(cause: CheckCause, retry = 0): void {
  if (runningBuild === null || leaving) return;
  if (checking) {
    if (cause === 'relayRestart') pendingRelayRestart = true;
    return;
  }
  if (cause === 'routine') {
    const now = performance.now();
    if (now - lastRoutineAt < MIN_ROUTINE_GAP_MS) return;
    lastRoutineAt = now;
  }
  checking = true;
  void fetchServedBuild()
    .then((served) => {
      if (leaving) return;
      const offered = served !== null && offer(served, cause);
      const wait = RELAY_RESTART_RETRY_MS[retry];
      if (cause === 'relayRestart' && !offered && wait !== undefined)
        setTimeout(() => requestUpdateCheck('relayRestart', retry + 1), wait);
    })
    .finally(() => {
      checking = false;
      if (pendingRelayRestart) {
        pendingRelayRestart = false;
        requestUpdateCheck('relayRestart');
      }
    });
}

async function fetchServedBuild(): Promise<ServedBuild | null> {
  try {
    const response = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    return parseServedBuild(await response.json());
  } catch {
    return null;
  }
}

function currentPlace(): UpdatePlace {
  if ([...relayRooms].some((inRoom) => inRoom())) return 'relayGame';
  return placeOfRoute(routeFor(new URLSearchParams(window.location.search)).id);
}

/** True when the host serves another build than this page's. */
function offer(served: ServedBuild, cause: CheckCause): boolean {
  if (runningBuild === null) return false;
  const choice = updateOffer({
    runningBuild,
    served,
    cause,
    place: currentPlace(),
    carriedRestore: continuation === null ? null : RESTORE_IDENTITY,
    reloadedFor: readReloadedFor(),
  });
  if (choice.kind === 'none') return false;
  const closedByPlayer = cause === 'routine' && performance.now() < quietUntil;
  if (choice.kind !== 'reloadNow' && (choice.kind === shown || closedByPlayer)) return true;
  show(choice, served, cause);
  return true;
}

function show(choice: UpdateOffer, served: ServedBuild, cause: CheckCause): void {
  const copy = messages().updateNotice;
  const text = (template: string, values: Readonly<Record<string, string | number>> = {}): string =>
    formatMessage(template, { version: served.version, running: GAME_VERSION, ...values });
  const dismiss: BannerAction = { label: copy.dismiss, run: closeBanner };
  const reload: BannerAction = { label: copy.reload, run: () => reloadInto(served, false) };
  stopCountdown();
  shown = choice.kind;
  switch (choice.kind) {
    case 'none':
      closeBanner();
      return;
    case 'reloadNow':
      leaving = true;
      showUpdateBanner(text(cause === 'relayRestart' ? copy.relayRestarted : copy.reloadingNow), []);
      setTimeout(() => void reloadAfterNotice(served, choice), RELOAD_NOTICE_MS);
      return;
    case 'countdown':
      startCountdown(served, text);
      return;
    case 'continue':
      showUpdateBanner(text(copy.continue), [
        { label: copy.reloadAndContinue, run: () => void continueInto(served) },
        dismiss,
      ]);
      return;
    case 'finishOrReload':
      showUpdateBanner(text(copy.finishOrReload), [reload, dismiss]);
      return;
    case 'finishThenReload':
      showUpdateBanner(text(copy.finishThenReload), [dismiss]);
      return;
    case 'manual':
      showUpdateBanner(text(copy.manual), [reload, dismiss]);
      return;
  }
}

function startCountdown(
  served: ServedBuild,
  text: (template: string, values?: Readonly<Record<string, string | number>>) => string,
): void {
  const copy = messages().updateNotice;
  let seconds = COUNTDOWN_SECONDS;
  showUpdateBanner(text(copy.countdown, { seconds }), [
    { label: copy.reloadNow, run: () => reloadInto(served, false) },
    { label: copy.later, run: closeBanner },
  ]);
  countdown = setInterval(() => {
    // The player left the menu for a game while the count ran: offer what fits the game instead.
    if (currentPlace() !== 'menu') {
      shown = null;
      offer(served, 'routine');
      return;
    }
    seconds--;
    if (seconds > 0) setUpdateBannerText(text(copy.countdown, { seconds }));
    else reloadInto(served, false);
  }, MS_PER_SECOND);
}

function closeBanner(): void {
  stopCountdown();
  hideUpdateBanner();
  shown = null;
  quietUntil = performance.now() + ROUTINE_CHECK_MS;
}

function stopCountdown(): void {
  if (countdown !== null) clearInterval(countdown);
  countdown = null;
}

/** A game that may still be sound is carried over; one whose staging fails reloads all the same. */
async function reloadAfterNotice(
  served: ServedBuild,
  choice: { toMenu: boolean; carry: boolean },
): Promise<void> {
  const carry = continuation;
  if (choice.carry && carry !== null) {
    try {
      await carry();
    } catch (error) {
      diag.warn('update', `staging the game for the reload failed: ${String(error)}`);
    }
  }
  reloadInto(served, choice.toMenu);
}

async function continueInto(served: ServedBuild): Promise<void> {
  if (leaving) return;
  const carry = continuation;
  if (carry === null) {
    reloadInto(served, false);
    return;
  }
  leaving = true;
  try {
    await carry();
  } catch (error) {
    leaving = false;
    diag.warn('update', `staging the game for the reload failed: ${String(error)}`);
    show({ kind: 'finishOrReload' }, served, 'routine');
    return;
  }
  reloadInto(served, false);
}

function reloadInto(served: ServedBuild, toMenu: boolean): void {
  leaving = true;
  stopCountdown();
  rememberReloadedFor(served.build);
  if (toMenu) {
    releaseDocument();
    window.location.replace(`${window.location.pathname}${menuSearch(window.location.search)}`);
  } else reloadDocument();
}

function readReloadedFor(): string | null {
  try {
    return window.sessionStorage.getItem(RELOADED_FOR_KEY);
  } catch {
    return null;
  }
}

function rememberReloadedFor(build: string): void {
  try {
    window.sessionStorage.setItem(RELOADED_FOR_KEY, build);
  } catch {
    // Storage denied: a host stuck on the old page may then reload this tab once per check.
  }
}
