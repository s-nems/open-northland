import type { PreviousShellRun } from '../../view/platform/desktop-faults.js';
import type { SessionMarker } from './session-marker.js';

/** How often a page rewrites its marker. */
export const MARKER_BEAT_MS = 5000;

/** A marker rewritten this recently may be another tab's, still running: three beats. A live page that
 *  went hidden wrote that down, and a hidden page's verdict does not depend on its age. */
export const MARKER_STALE_MS = 3 * MARKER_BEAT_MS;

/** What this page knows of the page it replaced in the same tab. */
export interface PreviousPage {
  readonly id: string;
  /** The browser discarded it to save memory (`document.wasDiscarded`); no crash. */
  readonly discarded: boolean;
}

export interface MarkerFacts {
  readonly nowMs: number;
  /** The page this one reloaded, or null after a navigation from elsewhere. */
  readonly previous: PreviousPage | null;
  /** Epoch milliseconds of each fault the desktop shell recorded. */
  readonly desktopFaults: readonly { readonly id: string; readonly atMs: number }[];
  /** The freeze record the marker's page left, if it left one; `seenAt` is when it was last seen frozen. */
  readonly freeze: { readonly id: string; readonly seenAt: number } | null;
  /** The desktop shell run that served the page. */
  readonly shellRun: PreviousShellRun | null;
}

export type MarkerVerdict =
  /** Another tab, still beating: left alone. */
  | { readonly kind: 'live' }
  /** Ended in a way that is no bug, or reports nothing worth it: removed. */
  | { readonly kind: 'quiet' }
  /** The shell saw that page hang or its renderer go: one report of its faults carries the marker's
   *  log, oldest first. */
  | { readonly kind: 'desktop'; readonly faultIds: readonly string[] }
  /** The page froze and never came back. */
  | { readonly kind: 'freeze'; readonly freezeId: string }
  | { readonly kind: 'unclean-exit' };

/** The system ended the session, or went to sleep and never woke, as the page stopped beating; a
 *  shutdown another app cancelled left the page running past it. */
function endedWithSystem(marker: SessionMarker, run: PreviousShellRun | null): boolean {
  if ((run?.end !== 'shutdown' && run?.end !== 'asleep') || run.endedAt === null) return false;
  return marker.beatAt <= Date.parse(run.endedAt) + MARKER_STALE_MS;
}

/**
 * What a marker left by another page means. The shell's own record of a crash wins over the page's
 * guess, and the watchdog's freeze record over a plain end. A page last seen hidden or in the menu
 * is not reported: a hidden page may be ended by the browser or the system without `pagehide`, and a
 * menu holds nothing a report could replay, while a game's sudden end is most likely a crash. Nor is
 * a page whose shell quit, or the system shut down or put to sleep for good.
 */
export function judgeMarker(marker: SessionMarker, facts: MarkerFacts): MarkerVerdict {
  const reloaded = facts.previous?.id === marker.id;
  if (reloaded && facts.previous?.discarded === true) return { kind: 'quiet' };
  // Before the age: the shell reloads a crashed page at once, so its marker is still fresh. A frozen
  // page stops beating, and the shell calls it hung only after Chromium's hang timeout of about 15 s:
  // its record of the hang counts up to the last moment the watchdog saw the page frozen.
  const lastAliveMs = Math.max(marker.beatAt, facts.freeze?.seenAt ?? marker.beatAt) + MARKER_STALE_MS;
  const faultIds = facts.desktopFaults
    .filter(({ atMs }) => atMs >= marker.startedAt && atMs <= lastAliveMs)
    .map((fault) => fault.id);
  if (faultIds.length > 0) return { kind: 'desktop', faultIds };
  if (!reloaded && facts.nowMs - marker.beatAt <= MARKER_STALE_MS) return { kind: 'live' };
  if (facts.freeze !== null) return { kind: 'freeze', freezeId: facts.freeze.id };
  // The shell quits after its windows closed. A page that crashed, or hung long enough to report, before
  // that left a fault or a freeze record, judged above, so a marker still left from it is no crash.
  const shellQuit = facts.shellRun?.end === 'quit';
  if (!marker.visible || !marker.context.inGame || shellQuit || endedWithSystem(marker, facts.shellRun))
    return { kind: 'quiet' };
  return { kind: 'unclean-exit' };
}
