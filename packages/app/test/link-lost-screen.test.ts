// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createLinkLostScreen,
  type LinkLostScreen,
  voteOpensInSeconds,
} from '../src/hud/dom/link-lost-screen.js';
import { KICK_COUNTDOWN_MS, type NetLinkLoss } from '../src/hud/network/model.js';
import { currentLocale, formatMessage, messages, setActiveLocale } from '../src/i18n/index.js';

const SECOND_MS = 1000;
const locale = currentLocale();
let screen: LinkLostScreen | null = null;

beforeEach(() => {
  setActiveLocale('eng');
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  screen?.dispose();
  screen = null;
  document.body.replaceChildren();
  setActiveLocale(locale);
  vi.unstubAllGlobals();
});

function mount() {
  const game = document.createElement('div');
  const order = document.createElement('button');
  order.textContent = 'order';
  game.append(order);
  document.body.append(game);
  const hud = document.createElement('div');
  document.body.append(hud);
  const time = { ms: 100_000 };
  const suspended: boolean[] = [];
  const onLeave = vi.fn();
  screen = createLinkLostScreen({
    hud: { element: hud, currentScale: () => 1 },
    setCameraSuspended: (next) => suspended.push(next),
    onLeave,
    now: () => time.ms,
  });
  const dropped = (): Extract<NetLinkLoss, { kind: 'dropped' }> => ({
    kind: 'dropped',
    waitedSinceMs: time.ms,
  });
  const dialog = (): HTMLElement => {
    const found = document.querySelector('.on-link-lost');
    if (!(found instanceof HTMLElement)) throw new Error('no lost-connection window');
    return found;
  };
  const text = (selector: string): string => dialog().querySelector(selector)?.textContent ?? '';
  return { game, order, time, suspended, onLeave, dropped, dialog, text, screen: screen };
}

describe('the lost-connection screen', () => {
  it('counts down the room’s wait from the moment the relay stopped hearing this client', () => {
    const since = 5000;
    const loss: NetLinkLoss = { kind: 'dropped', waitedSinceMs: since };
    expect(voteOpensInSeconds(loss, since)).toBe(KICK_COUNTDOWN_MS / SECOND_MS);
    expect(voteOpensInSeconds(loss, since + 1)).toBe(KICK_COUNTDOWN_MS / SECOND_MS);
    expect(voteOpensInSeconds(loss, since + SECOND_MS)).toBe(KICK_COUNTDOWN_MS / SECOND_MS - 1);
    expect(voteOpensInSeconds(loss, since + KICK_COUNTDOWN_MS)).toBe(0);
    expect(voteOpensInSeconds(loss, since + KICK_COUNTDOWN_MS * 2)).toBe(0);
  });

  it('takes the page over while the link is lost and gives it back once the relay is heard', () => {
    const { game, order, suspended, dropped, text, screen } = mount();
    order.focus();
    expect(screen.isOpen()).toBe(false);
    screen.refresh(dropped());
    expect(screen.isOpen()).toBe(true);
    expect(game.inert).toBe(true);
    expect(suspended).toEqual([true]);
    const copy = messages().hud.linkLost;
    expect(text('.on-window__title')).toBe(copy.title);
    expect(text('.on-link-lost__message')).toBe(copy.dropped);
    expect(text('.on-link-lost__countdown')).toBe(
      formatMessage(copy.seconds, { seconds: KICK_COUNTDOWN_MS / SECOND_MS }),
    );
    expect(text('.on-link-lost__hint')).toBe(copy.voteOpensIn);
    expect(document.activeElement?.textContent).toBe(copy.leave);
    screen.refresh(null);
    expect(screen.isOpen()).toBe(false);
    expect(game.inert).not.toBe(true);
    expect(suspended).toEqual([true, false]);
    expect(document.activeElement).toBe(order);
  });

  it('moves the seconds once a second and says the vote is open at zero', () => {
    const { time, dropped, text, screen } = mount();
    const copy = messages().hud.linkLost;
    const loss = dropped();
    screen.refresh(loss);
    time.ms += SECOND_MS * 2.5;
    screen.refresh(loss);
    expect(text('.on-link-lost__countdown')).toBe(
      formatMessage(copy.seconds, { seconds: KICK_COUNTDOWN_MS / SECOND_MS - 2 }),
    );
    time.ms = loss.waitedSinceMs + KICK_COUNTDOWN_MS;
    screen.refresh(loss);
    expect(text('.on-link-lost__countdown')).toBe(formatMessage(copy.seconds, { seconds: 0 }));
    expect(text('.on-link-lost__hint')).toBe(copy.voteOpen);
    expect(screen.isOpen()).toBe(true);
  });

  it('shows a link that will not reopen with its reason and no countdown', () => {
    const { text, dialog, screen } = mount();
    const copy = messages().hud.linkLost;
    screen.refresh({ kind: 'closed', reason: 'the relay shut down' });
    expect(text('.on-link-lost__message')).toBe(
      formatMessage(copy.closed, { reason: 'the relay shut down' }),
    );
    expect(dialog().querySelector('.on-link-lost__countdown')?.hasAttribute('hidden')).toBe(true);
    expect(text('.on-link-lost__hint')).toBe(copy.closedHint);
  });

  it('cancels an open native pick dialog, which would otherwise hold the top layer above it', () => {
    const { dropped, screen } = mount();
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    const cancelled = vi.fn((event: Event) => {
      event.preventDefault();
      dialog.removeAttribute('open');
    });
    dialog.addEventListener('cancel', cancelled);
    document.body.append(dialog);
    screen.refresh(dropped());
    expect(cancelled).toHaveBeenCalledOnce();
    expect(dialog.hasAttribute('open')).toBe(false);
  });

  it('lets no key reach the game and leaves on its one button', () => {
    const { dropped, onLeave, dialog, screen } = mount();
    screen.refresh(dropped());
    const reached: string[] = [];
    window.addEventListener('keydown', (event) => reached.push(event.key));
    for (const key of ['Escape', 'a', '1', 'Tab']) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }
    expect(reached).toEqual([]);
    expect(document.activeElement?.textContent).toBe(messages().hud.linkLost.leave);
    dialog().querySelector('button')?.click();
    expect(onLeave).toHaveBeenCalledOnce();
    // Disposed, the keys are the page's again.
    screen.dispose();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(reached).toEqual(['a']);
  });
});
