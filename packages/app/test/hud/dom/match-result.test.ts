// @vitest-environment jsdom

import type { MatchRank } from '@open-northland/sim';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createMatchResultOverlay,
  keepsPlayingAfterResult,
  type MatchResultOverlay,
} from '../../../src/hud/dom/match-result.js';
import { createLinkLostScreen } from '../../../src/hud/dom/network/link-lost-screen.js';
import { formatMessage, messages } from '../../../src/i18n/index.js';

const overlays: MatchResultOverlay[] = [];
afterEach(() => {
  for (const overlay of overlays.splice(0)) overlay.dispose();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
function setup(
  sharedClock: boolean,
  ranking: () => readonly MatchRank[] = () => [],
  {
    onLoad,
    playAgain,
    scriptedEnding,
    localPlayer = 0,
    playerNickOf,
  }: {
    onLoad?: (back: () => void) => void;
    playAgain?: () => void;
    scriptedEnding?: boolean;
    localPlayer?: number | null;
    playerNickOf?: (player: number) => string | undefined;
  } = {},
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
    localPlayer,
    sharedClock,
    ranking,
    ...(scriptedEnding === undefined ? {} : { scriptedEnding }),
    seatNameOf: (player) => (player === 1 ? 'Ragnar' : undefined),
    playerNickOf,
    pause,
    resume,
    onQuit,
    onContinue,
    hud: { element: hud, currentScale: () => 1 },
    onOpen: vi.fn(),
    setCameraSuspended: vi.fn(),
    ...(onLoad !== undefined ? { onLoad } : {}),
    ...(playAgain !== undefined ? { playAgain: { scope: 'thisMap', start: playAgain } } : {}),
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

it('defers campaign victory until the script finishes, and still reports a defeat immediately', () => {
  const won = setup(false, () => [], { scriptedEnding: true });
  won.overlay.onEvents([{ kind: 'playerWon', player: 0 }]);
  won.overlay.announce('victory');
  expect(won.body.children).toHaveLength(0);
  expect(won.pause).not.toHaveBeenCalled();
  won.overlay.setSuspended('missionBook', true);
  won.overlay.finish('victory');
  expect(won.overlay.isOpen()).toBe(false);
  won.overlay.setSuspended('missionBook', false);
  expect(document.querySelector('.on-result__title')?.textContent).toBe(messages().hud.matchWonTitle);
  expect(won.pause).toHaveBeenCalledOnce();
  expect(won.body.buttons().map((button) => button.textContent)).toEqual([
    messages().hud.matchContinue,
    messages().hud.returnToMenu,
  ]);
  expect(document.activeElement).toBe(won.body.buttons()[0]);
  won.body.buttons()[0]?.click();
  expect(won.onContinue).toHaveBeenCalledOnce();
  expect(won.onQuit).not.toHaveBeenCalled();
  expect(won.resume).toHaveBeenCalledOnce();
  won.overlay.finish('victory');
  expect(won.overlay.isOpen()).toBe(false);
  const lost = setup(false, () => [], { scriptedEnding: true });
  lost.overlay.onEvents([{ kind: 'playerDefeated', player: 0 }]);
  expect(lost.body.children).toHaveLength(1);
  expect(lost.pause).toHaveBeenCalledOnce();
  expect(lost.body.buttons()).toHaveLength(2);
  lost.body.buttons()[0]?.click();
  expect(lost.onContinue).toHaveBeenCalledOnce();
  expect(lost.onQuit).not.toHaveBeenCalled();
});

it('returns to the campaign menu without a confirmation after a scripted ending', () => {
  const h = setup(false, () => [], { scriptedEnding: true });
  h.overlay.finish('victory');
  h.body.buttons()[1]?.click();
  expect(h.onQuit).toHaveBeenCalledOnce();
  expect(h.onContinue).not.toHaveBeenCalled();
  expect(h.overlay.isOpen()).toBe(false);
});

it('lets a script that ends won missions exit after a victory, but not after a defeat the player watches', () => {
  const SCRIPT_ENDS_VICTORY = true;
  expect(keepsPlayingAfterResult('victory', false, SCRIPT_ENDS_VICTORY)).toBe(false);
  expect(keepsPlayingAfterResult('defeat', false, SCRIPT_ENDS_VICTORY)).toBe(true);
  expect(keepsPlayingAfterResult('undecided', false, SCRIPT_ENDS_VICTORY)).toBe(false);
  expect(keepsPlayingAfterResult('victory', false, !SCRIPT_ENDS_VICTORY)).toBe(true);
  expect(keepsPlayingAfterResult('undecided', true, SCRIPT_ENDS_VICTORY)).toBe(true);
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

it('names a ranked seat by the nick of the person who played it before the roster name', () => {
  setup(true, () => [{ player: 1, outcome: 'defeat' }], {
    playerNickOf: (player) => (player === 1 ? 'Ania' : undefined),
  }).overlay.announce('defeat');
  expect(document.querySelector('.on-result__rank-name')?.textContent).toBe('Ania');
});

it('shows a watcher the result once every person has a verdict, then the match end, as no seat of its own', () => {
  const h = setup(
    true,
    () => [
      { player: 1, outcome: 'defeat' },
      { player: 0, outcome: 'victory' },
    ],
    { localPlayer: null },
  );
  const copy = messages().hud;
  h.overlay.playersDecided('undecided');
  expect(document.querySelector('.on-result__kicker')?.textContent).toBe(copy.matchTribesKicker);
  expect(document.querySelector('.on-result__detail')).toBeNull();
  const rows = [...document.querySelectorAll<HTMLElement>('.on-result__rank')];
  expect(rows.map((row) => row.dataset.local)).toEqual([undefined, undefined]);
  h.body.buttons()[0]?.dispatchEvent(new Event('click'));
  h.overlay.playersDecided('undecided');
  expect(h.body.children).toHaveLength(0);
  h.overlay.finish('undecided');
  expect(document.querySelector('.on-result__detail')?.textContent).toBe(copy.matchFinishedDetail);
});

it('shows a shared winner its victory once every person has a verdict, before the match ends', () => {
  const h = setup(true);
  h.overlay.onEvents([{ kind: 'playerWon', player: 0 }]);
  expect(h.body.children).toHaveLength(0);
  h.overlay.playersDecided('victory');
  expect(document.querySelector('.on-result')?.getAttribute('data-result')).toBe('victory');
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
    h.overlay.setSuspended('linkLost', true);
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
    h.overlay.setSuspended('linkLost', false);
    expect(h.overlay.isOpen()).toBe(true);
    expect(h.hud.inert).toBe(true);
    h.body.buttons()[0]?.click();
    expect(h.onContinue).toHaveBeenCalledOnce();
    expect(h.hud.inert).not.toBe(true);
  } finally {
    lost.dispose();
  }
});

it('waits for the open mission book, so a closing briefing reads before the verdict', () => {
  const h = setup(false);
  h.overlay.setSuspended('missionBook', true);
  h.overlay.onEvents([{ kind: 'playerWon', player: 0 }]);
  expect(h.overlay.isOpen()).toBe(false);
  expect(h.pause).not.toHaveBeenCalled();
  h.overlay.setSuspended('missionBook', false);
  expect(h.overlay.isOpen()).toBe(true);
  // A page a later rule delivers takes the screen back, and the verdict returns once it is read.
  h.overlay.setSuspended('missionBook', true);
  expect(h.overlay.isOpen()).toBe(false);
  expect(h.hud.inert).not.toBe(true);
  h.overlay.setSuspended('linkLost', true);
  h.overlay.setSuspended('missionBook', false);
  expect(h.overlay.isOpen()).toBe(false);
  h.overlay.setSuspended('linkLost', false);
  expect(h.overlay.isOpen()).toBe(true);
  h.body.buttons()[0]?.click();
  expect(h.onContinue).toHaveBeenCalledOnce();
});

it('offers loading after a local defeat and returns to the result when the load page closes', () => {
  const loadPage: { back?: () => void } = {};
  const openLoad = (back: () => void): void => {
    loadPage.back = back;
  };
  const won = setup(false, () => [], { onLoad: openLoad });
  won.overlay.announce('victory');
  expect(won.body.buttons()).toHaveLength(2);
  won.overlay.dispose();

  const h = setup(false, () => [], { onLoad: openLoad });
  h.overlay.announce('defeat');
  const copy = messages().hud;
  expect(h.body.buttons().map((button) => button.textContent)).toEqual([
    copy.matchContinue,
    copy.loadGame,
    copy.returnToMenu,
  ]);
  h.body.buttons()[1]?.click();
  expect(h.overlay.isOpen()).toBe(false);
  expect(h.onContinue).not.toHaveBeenCalled();
  expect(h.resume).toHaveBeenCalledOnce();
  loadPage.back?.();
  expect(h.overlay.isOpen()).toBe(true);
  expect(h.pause).toHaveBeenCalledTimes(2);
  h.overlay.dispose();
  loadPage.back?.();
  expect(h.overlay.isOpen()).toBe(false);
});

it('offers a lost local map again behind a confirmation, and not after a victory', async () => {
  const playAgain = vi.fn();
  const won = setup(false, () => [], { playAgain });
  won.overlay.announce('victory');
  expect(won.body.buttons()).toHaveLength(2);
  won.overlay.dispose();

  const h = setup(false, () => [], { onLoad: vi.fn(), playAgain });
  h.overlay.announce('defeat');
  const copy = messages().hud;
  expect(h.body.buttons().map((button) => button.textContent)).toEqual([
    copy.matchContinue,
    copy.playAgain,
    copy.loadGame,
    copy.returnToMenu,
  ]);
  h.body.buttons()[1]?.click();
  const question = document.querySelector('.on-system-confirm');
  expect(question?.textContent).toContain(copy.playAgainConfirm);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await Promise.resolve();
  expect(playAgain).not.toHaveBeenCalled();
  expect(h.overlay.isOpen()).toBe(true);

  h.body.buttons()[1]?.click();
  const yes = [...document.querySelectorAll<HTMLButtonElement>('.on-system-confirm button')].find(
    (button) => button.textContent === copy.playAgain,
  );
  yes?.click();
  await Promise.resolve();
  expect(playAgain).toHaveBeenCalledOnce();
  expect(h.onQuit).not.toHaveBeenCalled();
  expect(h.onContinue).not.toHaveBeenCalled();
  expect(h.overlay.isOpen()).toBe(false);
});
