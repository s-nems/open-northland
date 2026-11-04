import { describe, expect, it } from 'vitest';
import type { SessionMarker } from '../../../src/diag/capture/session-marker.js';
import {
  judgeMarker,
  MARKER_STALE_MS,
  type MarkerFacts,
  type MarkerVerdict,
} from '../../../src/diag/capture/unclean-exit.js';
import type { PreviousShellRun } from '../../../src/view/platform/desktop-faults.js';

const STARTED_AT = 1_000_000;
const BEAT_AT = 2_000_000;
const LONG_AFTER = BEAT_AT + 10 * MARKER_STALE_MS;
const JUST_AFTER = BEAT_AT + 1000;

const marker: SessionMarker = {
  id: 'a'.repeat(32),
  startedAt: STARTED_AT,
  beatAt: BEAT_AT,
  visible: true,
  context: { entry: 'map', search: '?map=x', worldId: 'x', tick: 500, inGame: true, booting: false },
};

const facts = (over: Partial<MarkerFacts> = {}): MarkerFacts => ({
  nowMs: LONG_AFTER,
  previous: null,
  desktopFaults: [],
  freeze: null,
  shellRun: null,
  ...over,
});

const kind = (verdict: MarkerVerdict): string => verdict.kind;

const shellRun = (end: PreviousShellRun['end'], endedAtMs: number): PreviousShellRun => ({
  from: new Date(STARTED_AT - 1).toISOString(),
  until: new Date(LONG_AFTER).toISOString(),
  end,
  endedAt: new Date(endedAtMs).toISOString(),
});

describe('judgeMarker', () => {
  it('reports a game page last seen visible that left its marker behind', () => {
    expect(judgeMarker(marker, facts())).toEqual({ kind: 'unclean-exit' });
  });

  it('keeps quiet about a page last seen hidden, in the menu, discarded, or ended with its shell or system', () => {
    const verdicts = [
      judgeMarker({ ...marker, visible: false }, facts()),
      judgeMarker({ ...marker, context: { ...marker.context, inGame: false, entry: 'menu' } }, facts()),
      judgeMarker(marker, facts({ previous: { id: marker.id, discarded: true } })),
      judgeMarker(marker, facts({ shellRun: shellRun('shutdown', BEAT_AT + 1000) })),
      judgeMarker(marker, facts({ shellRun: shellRun('asleep', BEAT_AT + 1000) })),
      judgeMarker(marker, facts({ shellRun: shellRun('quit', LONG_AFTER) })),
    ].map(kind);
    expect(verdicts).toEqual(['quiet', 'quiet', 'quiet', 'quiet', 'quiet', 'quiet']);
    expect(kind(judgeMarker(marker, facts({ shellRun: shellRun('crash', BEAT_AT + 1000) })))).toBe(
      'unclean-exit',
    );
  });

  it('still reports a crash or a freeze the shell or the watchdog saw in a run that quit', () => {
    const quit = shellRun('quit', LONG_AFTER);
    const gone = { id: 'd'.repeat(32), atMs: BEAT_AT + 500 };
    const freeze = { id: 'f'.repeat(32), seenAt: BEAT_AT };
    expect(judgeMarker(marker, facts({ shellRun: quit, desktopFaults: [gone] }))).toEqual({
      kind: 'desktop',
      faultIds: [gone.id],
    });
    expect(judgeMarker(marker, facts({ shellRun: quit, freeze }))).toEqual({
      kind: 'freeze',
      freezeId: freeze.id,
    });
  });

  it('reports a page that beat on past a shutdown notice: that shutdown was cancelled', () => {
    const cancelled = shellRun('shutdown', BEAT_AT - 2 * MARKER_STALE_MS);
    expect(kind(judgeMarker(marker, facts({ shellRun: cancelled })))).toBe('unclean-exit');
  });

  it('leaves a recently beating marker to its tab, unless this page reloaded that one', () => {
    expect(kind(judgeMarker(marker, facts({ nowMs: JUST_AFTER })))).toBe('live');
    expect(
      kind(judgeMarker(marker, facts({ nowMs: JUST_AFTER, previous: { id: marker.id, discarded: false } }))),
    ).toBe('unclean-exit');
  });

  it("prefers the desktop shell's faults of that page's lifetime, then the watchdog's freeze record", () => {
    const during = { id: 'd'.repeat(32), atMs: BEAT_AT + 500 };
    const before = { id: 'e'.repeat(32), atMs: STARTED_AT - 1 };
    const freeze = { id: 'f'.repeat(32), seenAt: BEAT_AT };
    // Fresh as the shell's reload after a crash leaves it, and frozen before that.
    expect(
      judgeMarker(marker, facts({ nowMs: JUST_AFTER, desktopFaults: [during, before], freeze })),
    ).toEqual({
      kind: 'desktop',
      faultIds: [during.id],
    });
    expect(
      judgeMarker({ ...marker, context: { ...marker.context, inGame: false } }, facts({ freeze })),
    ).toEqual({
      kind: 'freeze',
      freezeId: freeze.id,
    });
  });

  it("counts a hang the shell saw while the watchdog still saw the page frozen as that page's", () => {
    const hang = { id: 'd'.repeat(32), atMs: BEAT_AT + 2 * MARKER_STALE_MS };
    const freeze = { id: 'f'.repeat(32), seenAt: hang.atMs + 10_000 };
    expect(judgeMarker(marker, facts({ desktopFaults: [hang] }))).toEqual({ kind: 'unclean-exit' });
    expect(judgeMarker(marker, facts({ desktopFaults: [hang], freeze }))).toEqual({
      kind: 'desktop',
      faultIds: [hang.id],
    });
  });
});
