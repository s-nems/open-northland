// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** The module keeps the document's hold, so each test gets a fresh copy. */
async function freshGuard() {
  vi.resetModules();
  return import('../src/view/navigation-guard.js');
}

type Guard = Awaited<ReturnType<typeof freshGuard>>;

const GAME = '/?map=fjord&seed=7';
const MENU = '/?lang=pol';

/** The player's first touch of the game, which lets the trap entry in. */
function gesture(): void {
  window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }));
}

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', { cancelable: true, ...init });
}

describe('navigation guard', () => {
  let guard: Guard;
  let uninstall: () => void = () => undefined;
  let pushState: ReturnType<typeof vi.spyOn>;
  const reload = vi.fn();

  beforeEach(async () => {
    window.history.replaceState(null, '', MENU);
    guard = await freshGuard();
    uninstall = guard.installNavigationGuard(reload);
    pushState = vi.spyOn(window.history, 'pushState');
    reload.mockClear();
  });

  afterEach(() => {
    uninstall();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  });

  it('holds the document for the entries that run a game', () => {
    expect(guard.routeHoldsGame('map')).toBe(true);
    expect(guard.routeHoldsGame('relay')).toBe(true);
    expect(guard.routeHoldsGame('menu')).toBe(false);
    expect(guard.routeHoldsGame('scene')).toBe(false);
    expect(guard.routeHoldsGame('anim')).toBe(false);
  });

  it('puts a trap entry under a game at the first gesture and pushes it back after a back traversal', () => {
    guard.pushEntryUrl(GAME);
    guard.guardEntry('map');
    expect(pushState).toHaveBeenCalledTimes(1);
    gesture();
    gesture();

    expect(pushState).toHaveBeenCalledTimes(2);
    expect(pushState).toHaveBeenLastCalledWith(null, '', expect.stringContaining(GAME));
    pushState.mockClear();

    // Back lands on the game's own entry: same document, same address.
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(pushState).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
    expect(window.location.search).toBe('?map=fjord&seed=7');
  });

  it('puts the game address back when a traversal skipped below its entries', () => {
    window.history.replaceState(null, '', GAME);
    guard.guardEntry('map');
    gesture();
    pushState.mockClear();

    window.history.replaceState(null, '', MENU);
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(pushState).toHaveBeenCalledWith(null, '', `http://localhost:3000${GAME}`);
  });

  it("follows a game-to-game handover and the running entry's rewrites of its address", () => {
    guard.pushEntryUrl(GAME);
    guard.guardEntry('map');
    guard.replaceEntryUrl(`${GAME}&fog=classic`);
    guard.pushEntryUrl('/?relay=wss://relay.test');
    guard.guardEntry('relay');
    guard.replaceEntryUrl('/?relay=wss://relay.test&room=r1');
    pushState.mockClear();

    window.history.replaceState(null, '', MENU);
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(pushState).toHaveBeenCalledWith(null, '', 'http://localhost:3000/?relay=wss://relay.test&room=r1');
  });

  it('pushes one trap however many game entries follow each other', () => {
    guard.guardEntry('map');
    gesture();
    guard.guardEntry('map');
    guard.guardEntry('relay');
    gesture();

    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it('waits for an input that grants activation: not Escape, not a touch', () => {
    guard.guardEntry('map');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch' }));
    expect(pushState).not.toHaveBeenCalled();

    window.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse' }));
    expect(pushState).toHaveBeenCalledTimes(1);
  });

  it('owes no trap to a game that was released before the player touched it', () => {
    guard.guardEntry('map');
    guard.releaseDocument();
    gesture();

    expect(pushState).not.toHaveBeenCalled();
  });

  it('reloads without a prompt when the game itself asks for the reload', () => {
    guard.guardEntry('map');
    guard.reloadDocument();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });

  it('reloads on a back traversal once the document swapped entries and no game holds it', () => {
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(reload).not.toHaveBeenCalled();

    guard.pushEntryUrl(GAME);
    guard.guardEntry('map');
    guard.pushEntryUrl(MENU);
    guard.guardEntry('menu');
    window.dispatchEvent(new PopStateEvent('popstate'));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("cancels the mouse's back and forward buttons only while a game holds the document", () => {
    const back = () => {
      const event = new MouseEvent('mouseup', { button: 3, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const forward = () => {
      const event = new MouseEvent('auxclick', { button: 4, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const primary = () => {
      const event = new MouseEvent('mouseup', { button: 0, cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(back()).toBe(false);
    guard.guardEntry('map');
    expect(back()).toBe(true);
    expect(forward()).toBe(true);
    expect(primary()).toBe(false);
  });

  it('cancels the browser keys and the zoom wheel while a game holds the document', () => {
    guard.guardEntry('map');
    const reloadKey = key({ key: 'r', ctrlKey: true });
    window.dispatchEvent(reloadKey);
    const gameKey = key({ key: 'r' });
    window.dispatchEvent(gameKey);
    const zoom = new WheelEvent('wheel', { ctrlKey: true, cancelable: true });
    window.dispatchEvent(zoom);
    const scroll = new WheelEvent('wheel', { cancelable: true });
    window.dispatchEvent(scroll);

    expect(reloadKey.defaultPrevented).toBe(true);
    expect(gameKey.defaultPrevented).toBe(false);
    expect(zoom.defaultPrevented).toBe(true);
    expect(scroll.defaultPrevented).toBe(false);
  });

  it('asks before the document unloads while a game holds it, except under automation', () => {
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };

    expect(unload()).toBe(false);
    guard.guardEntry('map');
    expect(unload()).toBe(true);
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    expect(unload()).toBe(false);
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
    guard.releaseDocument();
    expect(unload()).toBe(false);
  });

  it('never lets a dropped file or link navigate the document', () => {
    const drop = new Event('drop', { cancelable: true });
    window.dispatchEvent(drop);
    const over = new Event('dragover', { cancelable: true });
    window.dispatchEvent(over);

    expect(drop.defaultPrevented).toBe(true);
    expect(over.defaultPrevented).toBe(true);
  });
});

describe('isBrowserShortcut', () => {
  let guard: Guard;
  beforeEach(async () => {
    guard = await freshGuard();
  });

  it.each<[string, KeyboardEventInit]>([
    ['Alt+Left', { key: 'ArrowLeft', altKey: true }],
    ['Alt+Right', { key: 'ArrowRight', altKey: true }],
    ['Cmd+Left', { key: 'ArrowLeft', metaKey: true }],
    ['Cmd+[', { key: '[', metaKey: true }],
    ['Cmd+]', { key: ']', metaKey: true }],
    ['Backspace', { key: 'Backspace' }],
    ['F5', { key: 'F5' }],
    ['Ctrl+F5', { key: 'F5', ctrlKey: true }],
    ['Ctrl+R', { key: 'r', ctrlKey: true }],
    ['Ctrl+Shift+R', { key: 'R', ctrlKey: true, shiftKey: true }],
    ['Cmd+R', { key: 'r', metaKey: true }],
    ['Ctrl+Plus', { key: '+', ctrlKey: true }],
    ['Ctrl+=', { key: '=', ctrlKey: true }],
    ['Ctrl+Minus', { key: '-', ctrlKey: true }],
    ['Ctrl+0', { key: '0', ctrlKey: true }],
    ['Cmd+NumpadAdd', { key: '+', code: 'NumpadAdd', metaKey: true }],
  ])('names %s as the browser leaving or rescaling the game', (_name, init) => {
    expect(guard.isBrowserShortcut(key(init), false)).toBe(true);
  });

  it.each<[string, KeyboardEventInit]>([
    ['a bare arrow, the camera pan', { key: 'ArrowLeft' }],
    ['Ctrl+Alt+Left, a system chord', { key: 'ArrowLeft', ctrlKey: true, altKey: true }],
    ['a plain letter', { key: 'r' }],
    ['Ctrl+Digit1, a control group', { key: '1', ctrlKey: true }],
    ['Shift+Digit0, a control group', { key: ')', code: 'Digit0', shiftKey: true }],
    ['F4, the save key', { key: 'F4' }],
    ['Alt+Enter, the fullscreen toggle', { key: 'Enter', altKey: true }],
  ])('leaves %s to the game', (_name, init) => {
    expect(guard.isBrowserShortcut(key(init), false)).toBe(false);
  });

  it('leaves a text field its caret keys, Option+arrow word jumps included', () => {
    expect(guard.isBrowserShortcut(key({ key: 'Backspace' }), true)).toBe(false);
    expect(guard.isBrowserShortcut(key({ key: 'ArrowLeft', metaKey: true }), true)).toBe(false);
    expect(guard.isBrowserShortcut(key({ key: 'ArrowLeft', altKey: true }), true)).toBe(false);
  });
});
