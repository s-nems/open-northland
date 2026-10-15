// @vitest-environment jsdom

import type { MatchRank } from '@open-northland/sim';
import { afterEach, expect, it, vi } from 'vitest';
import { createLinkLostScreen } from '../src/hud/dom/link-lost-screen.js';
import { createMatchResultOverlay, type MatchResultOverlay } from '../src/hud/dom/match-result.js';
import { formatMessage, messages } from '../src/i18n/index.js';

const overlays: MatchResultOverlay[] = [];
afterEach(() => {
  for (const overlay of overlays.splice(0)) overlay.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function setup(
  sharedClock: boolean,
  ranking: () => readonly MatchRank[] = () => [],
  announcesVictory?: boolean,
) {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const pause = vi.fn();
  const resume = vi.fn();
  const onQuit = vi.fn();
  const onContinue = vi.fn();
  const hud = document.createElement('div');
  document.body.append(hud);
  const overlay = createMatchResultOverlay({
    localPlayer: 0,
    sharedClock,
    ranking,
    ...(announcesVictory === undefined ? {} : { announcesVictory }),
    seatNameOf: (player) => (player === 1 ? 'Ragnar' : undefined),
    pause,
    resume,
    onQuit,
    onContinue,
    hud: { element: hud, currentScale: () => 1 },
    onOpen: vi.fn(),
    setCameraSuspended: vi.fn(),
  });
  overlays.push(overlay);
  const body = {
    buttons: () => [...document.querySelectorAll<HTMLButtonElement>('.on-result button')],
    get children() {
      return document.querySelectorAll('.on-result-backdrop');
    },
  };
  return { body, pause, resume, onQuit, onContinue, overlay, hud };
}

it('lets a defeated player watch without pausing and inspect the map after the match ends', () => {
  const h = setup(true);
  h.overlay.announce('defeat');
  expect(h.body.buttons()).toHaveLength(2);
  h.body.buttons()[0]?.dispatchEvent(new Event('click'));
  expect(h.body.children).toHaveLength(0);
  expect(h.pause).not.toHaveBeenCalled();
  expect(h.resume).not.toHaveBeenCalled();
  h.overlay.finish('defeat');
  expect(h.body.children).toHaveLength(1);
  expect(h.body.buttons()).toHaveLength(2);
  h.overlay.finish('defeat');
  h.overlay.announce('victory');
  expect(h.body.children).toHaveLength(1);
  h.body.buttons()[1]?.click();
  expect(h.onQuit).toHaveBeenCalledOnce();
  expect(h.body.children).toHaveLength(0);
});

it('leaves a won mission to a script that ends it, and still reports its defeat', () => {
  const h = setup(false, () => [], false);
  h.overlay.onEvents([{ kind: 'playerWon', player: 0 }]);
  h.overlay.announce('victory');
  expect(h.body.children).toHaveLength(0);
  expect(h.pause).not.toHaveBeenCalled();
  h.overlay.onEvents([{ kind: 'playerDefeated', player: 0 }]);
  expect(h.body.children).toHaveLength(1);
  expect(h.pause).toHaveBeenCalledOnce();
});

it('lists the goal table ranking in verdict order, naming the roster seat and numbering the rest', () => {
  const h = setup(false, () => [
    { player: 1, outcome: 'defeat' },
    { player: 0, outcome: 'victory' },
  ]);
  h.overlay.announce('victory');
  const rows = [...document.querySelectorAll<HTMLElement>('.on-result__rank')];
  const copy = messages().hud;
  const text = (row: HTMLElement, part: string): string | null | undefined =>
    row.querySelector(`.on-result__rank-${part}`)?.textContent;
  expect(rows.map((row) => text(row, 'name'))).toEqual([
    'Ragnar',
    formatMessage(copy.matchRankSeat, { n: 1 }),
  ]);
  expect(rows.map((row) => text(row, 'verdict'))).toEqual([copy.matchRankLost, copy.matchRankWon]);
  expect(rows.map((row) => text(row, 'no'))).toEqual(['1.', '2.']);
  expect(rows.map((row) => row.dataset.local)).toEqual([undefined, 'true']);
  expect(rows.map((row) => row.dataset.outcome)).toEqual(['defeat', 'victory']);
  h.overlay.dispose();
  expect(h.body.children).toHaveLength(0);
});

it('replaces an open earlier defeat and supports an observer without a local outcome', () => {
  const h = setup(true);
  h.overlay.announce('defeat');
  h.overlay.finish('undecided');
  expect(h.body.children).toHaveLength(1);
  expect(h.body.buttons()).toHaveLength(2);
  h.overlay.dispose();
  expect(h.body.children).toHaveLength(0);
});

it.each(['victory', 'defeat'] as const)(
  'continues a local %s without quitting and restores input',
  (outcome) => {
    const h = setup(false);
    h.overlay.announce(outcome);
    expect(h.hud.inert).toBe(true);
    expect(h.pause).toHaveBeenCalledOnce();
    expect(h.body.buttons()).toHaveLength(2);
    h.body.buttons()[0]?.dispatchEvent(new Event('click'));
    expect(h.resume).toHaveBeenCalledOnce();
    expect(h.onContinue).toHaveBeenCalledOnce();
    expect(h.onQuit).not.toHaveBeenCalled();
    expect(h.hud.inert).not.toBe(true);
    h.overlay.announce('victory');
    expect(h.body.children).toHaveLength(0);
  },
);

it('waits for server confirmation before showing shared victory', () => {
  const h = setup(true);
  h.overlay.announce('victory');
  expect(h.body.children).toHaveLength(0);
  h.overlay.finish('victory');
  expect(h.body.buttons()).toHaveLength(2);
  expect(h.pause).not.toHaveBeenCalled();
});

it.each(['playerWon', 'playerDefeated'] as const)(
  'shows an immediate scripted %s in a shared game without pausing it',
  (kind) => {
    const h = setup(true);
    h.overlay.onEvents([{ kind, player: 0, scripted: true }]);
    expect(h.body.children).toHaveLength(1);
    expect(h.body.buttons()).toHaveLength(2);
    expect(h.pause).not.toHaveBeenCalled();
    h.body.buttons()[0]?.dispatchEvent(new Event('click'));
    h.overlay.onEvents([{ kind, player: 0 }]);
    expect(h.body.children).toHaveLength(0);
    h.overlay.finish(kind === 'playerWon' ? 'victory' : 'defeat');
    expect(h.body.buttons()).toHaveLength(2);
  },
);

it('does not let a suppressed shared victory hide a later scripted notice in the same frame', () => {
  const h = setup(true);
  h.overlay.onEvents([
    { kind: 'playerWon', player: 0 },
    { kind: 'playerWon', player: 0, scripted: true },
  ]);
  expect(h.body.children).toHaveLength(1);
  expect(h.body.buttons()).toHaveLength(2);
  expect(h.pause).not.toHaveBeenCalled();
});

it.each(['playerWon', 'playerDefeated'] as const)(
  'does not redisplay a previously announced %s after loading a save',
  (kind) => {
    const h = setup(false);
    h.overlay.onEvents([{ kind, player: 0, notificationAlreadySent: true }]);
    expect(h.body.children).toHaveLength(0);
    expect(h.pause).not.toHaveBeenCalled();
  },
);

it('keeps keyboard focus in the result, cancels leaving, and resumes with Escape', async () => {
  const h = setup(false);
  h.hud.tabIndex = 0;
  h.hud.focus();
  h.overlay.announce('defeat');
  const [stay, quit] = h.body.buttons();
  expect(document.activeElement).toBe(stay);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
  expect(document.activeElement).toBe(quit);
  quit?.click();
  expect(document.querySelector('.on-system-confirm')).not.toBeNull();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await Promise.resolve();
  expect(h.onQuit).not.toHaveBeenCalled();
  expect(h.overlay.isOpen()).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(h.onContinue).toHaveBeenCalledOnce();
  expect(h.overlay.isOpen()).toBe(false);
  expect(document.activeElement).toBe(h.hud);
});

it('cancels an outstanding quit confirmation when disposed', async () => {
  const h = setup(false);
  h.overlay.announce('defeat');
  h.body.buttons()[1]?.click();
  h.overlay.dispose();
  await Promise.resolve();
  expect(h.onQuit).not.toHaveBeenCalled();
  expect(h.resume).toHaveBeenCalledOnce();
  expect(document.querySelector('.on-system-confirm')).toBeNull();
});

it('yields a pending result to connection loss and restores usable input after reconnect', () => {
  const h = setup(true);
  const lost = createLinkLostScreen({
    hud: { element: h.hud, currentScale: () => 1 },
    setCameraSuspended: vi.fn(),
    onLeave: vi.fn(),
  });
  try {
    h.overlay.announce('defeat');
    h.overlay.setSuspended(true);
    lost.refresh({ kind: 'dropped', waitedSinceMs: 0 });
    expect(
      document.querySelector('.on-link-lost')?.closest<HTMLElement>('.on-system-backdrop')?.inert,
    ).not.toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h.onContinue).not.toHaveBeenCalled();
    expect(h.overlay.isOpen()).toBe(false);
    // A terminal result can arrive during reconnect and supersede the pending defeat.
    h.overlay.finish('undecided');
    expect(h.overlay.isOpen()).toBe(false);
    lost.refresh(null);
    h.overlay.setSuspended(false);
    expect(h.overlay.isOpen()).toBe(true);
    expect(h.hud.inert).toBe(true);
    h.body.buttons()[0]?.click();
    expect(h.onContinue).toHaveBeenCalledOnce();
    expect(h.hud.inert).not.toBe(true);
  } finally {
    lost.dispose();
  }
});
