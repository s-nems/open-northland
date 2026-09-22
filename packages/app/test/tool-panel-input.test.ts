import type { UiCue } from '@open-northland/audio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS } from '../src/hud/keybindings.js';
import { createToolPanelInput, type HeldMode } from '../src/hud/tool-panel/input.js';
import type { NavEntryId } from '../src/hud/tool-panel/nav-effects.js';
import type { ToolWindows } from '../src/hud/tool-panel/windows.js';

/**
 * The tool panel's canvas and key input over a fake canvas and window: which press plays which GUI
 * click, the Escape ladder (a held mode, then the open central window, then the unit controls' turn,
 * then the game menu), the menu and window hotkeys and the F-row.
 */

/** A press the handler reads like a MouseEvent: client point, button, modifiers. */
function press(x: number, y: number, button = 0): Event {
  return Object.assign(new Event('mousedown', { cancelable: true }), {
    clientX: x,
    clientY: y,
    button,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  });
}

function key(code: string): Event {
  return Object.assign(new Event('keydown', { cancelable: true }), { code, key: code });
}

/** A hold that stays active until cancelled and takes no world click of its own. */
function heldMode(): HeldMode & { active: boolean } {
  const mode = {
    active: false,
    isActive: (): boolean => mode.active,
    cancel: (): void => {
      mode.active = false;
    },
    handleClick: (): boolean => mode.active,
  };
  return mode;
}

const CLOSED_WINDOWS = {
  byId: { mission: { isOpen: () => false, close: () => undefined } },
  claims: () => false,
  handleClick: () => false,
  handleWheel: () => false,
  handleHover: () => undefined,
} as unknown as ToolWindows;

/** The key listener registers on `window` and its typing-target guard probes DOM classes; the node test
 *  environment has neither, so each test lends empty stand-ins. */
let windowTarget: EventTarget;
beforeEach(() => {
  windowTarget = new EventTarget();
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('HTMLInputElement', TextField);
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('HTMLSelectElement', Dropdown);
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('Element', DialogButton);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stand-ins for the DOM classes the keyboard-owner guard probes. */
class TextField {}
class Dropdown {}
class DialogButton {
  closest(selector: string): object | null {
    return selector === '[aria-modal="true"]' ? this : null;
  }
}

function mount(keyboardOwned?: () => boolean, escapeClaimed?: () => boolean) {
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  const cues: UiCue[] = [];
  let menuOpened = 0;
  const navToggled: NavEntryId[] = [];
  let hudToggled = 0;
  const held = heldMode();
  const arm = (): void => {
    held.active = true;
  };
  let windowOpen = false;
  const closed: number[] = [];
  const input = createToolPanelInput({
    canvas,
    toCanvas: (x, y) => ({ x, y }),
    windows: CLOSED_WINDOWS,
    held: [held],
    bindings: DEFAULT_KEY_BINDINGS,
    closeWindow: () => {
      if (!windowOpen) return false;
      windowOpen = false;
      closed.push(1);
      return true;
    },
    ...(keyboardOwned !== undefined ? { keyboardOwned } : {}),
    ...(escapeClaimed !== undefined ? { escapeClaimed } : {}),
    openMenu: () => {
      menuOpened++;
    },
    toggleNav: (id) => {
      navToggled.push(id);
    },
    togglePause: () => undefined,
    toggleHud: () => {
      hudToggled++;
    },
    cue: (cue) => {
      cues.push(cue);
    },
  });
  return {
    canvas,
    input,
    cues,
    held,
    arm,
    openWindow: (): void => {
      windowOpen = true;
    },
    closed,
    windowTarget,
    menuOpened: (): number => menuOpened,
    navToggled,
    hudToggled: (): number => hudToggled,
  };
}

describe('tool panel input clicks', () => {
  it('fails a right-click that calls a held mode off, and stays silent with nothing held', () => {
    const { canvas, input, cues, held, arm } = mount();
    canvas.dispatchEvent(press(400, 300, 2));
    expect(cues).toEqual([]);
    arm();
    canvas.dispatchEvent(press(400, 300, 2));
    expect(cues).toEqual(['fail']);
    expect(held.isActive()).toBe(false);
    input.dispose();
  });

  it('lets a plain left press through to the world when nothing claims it', () => {
    const { canvas, input, cues } = mount();
    const event = press(400, 300);
    canvas.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(cues).toEqual([]);
    input.dispose();
  });
});

describe('tool panel Escape ladder', () => {
  it('cancels a held mode first, then closes the open window, then leaves the press to a claimant', () => {
    const { input, cues, held, arm, openWindow, closed, windowTarget, menuOpened } = mount(
      undefined,
      () => true,
    );
    arm();
    openWindow();

    const first = key('Escape');
    windowTarget.dispatchEvent(first);
    expect(held.isActive()).toBe(false);
    expect(closed).toEqual([]);
    expect(cues).toEqual(['fail']);
    expect(first.defaultPrevented).toBe(true);

    const second = key('Escape');
    windowTarget.dispatchEvent(second);
    expect(closed).toEqual([1]);
    expect(second.defaultPrevented).toBe(true);

    const third = key('Escape');
    windowTarget.dispatchEvent(third);
    expect(third.defaultPrevented).toBe(false); // nothing left for the shell: the unit controls' turn
    expect(cues).toEqual(['fail']);
    expect(menuOpened()).toBe(0);
    input.dispose();
  });

  it('opens the game menu on Escape once nothing is held, open or claimed', () => {
    const { input, openWindow, windowTarget, menuOpened } = mount(undefined, () => false);
    openWindow();
    windowTarget.dispatchEvent(key('Escape'));
    expect(menuOpened()).toBe(0);
    const clear = key('Escape');
    windowTarget.dispatchEvent(clear);
    expect(menuOpened()).toBe(1);
    expect(clear.defaultPrevented).toBe(true);
    input.dispose();
  });

  it('leaves the menu shut when a DOM surface already took the Escape', () => {
    windowTarget.addEventListener('keydown', (e) => e.preventDefault()); // a breakdown or a pinned note
    const { input, windowTarget: target, menuOpened } = mount(undefined, () => false);
    target.dispatchEvent(key('Escape'));
    expect(menuOpened()).toBe(0);
    input.dispose();
  });

  it('opens the menu at once on a key of its own, and keeps Escape as the plain cancel', () => {
    const { input, arm, held, openWindow, closed, windowTarget, menuOpened } = mount(undefined, () => false);
    const bindings = { ...DEFAULT_KEY_BINDINGS, gameMenu: 'KeyM' };
    const other = createToolPanelInput({
      canvas: new EventTarget() as unknown as HTMLCanvasElement,
      toCanvas: (x, y) => ({ x, y }),
      windows: CLOSED_WINDOWS,
      held: [],
      bindings,
      closeWindow: () => false,
      openMenu: () => {
        opened++;
      },
      toggleNav: () => undefined,
      togglePause: () => undefined,
      toggleHud: () => undefined,
      cue: () => undefined,
    });
    let opened = 0;
    input.dispose();
    arm();
    openWindow();
    const menuKey = key('KeyM');
    windowTarget.dispatchEvent(menuKey);
    expect(opened).toBe(1);
    expect(menuKey.defaultPrevented).toBe(true);
    expect(held.isActive()).toBe(true); // the ladder is Escape's alone
    expect(closed).toEqual([]);
    windowTarget.dispatchEvent(key('Escape'));
    expect(opened).toBe(1);
    expect(menuOpened()).toBe(0);
    other.dispose();
  });

  it('toggles each beam window on its key, unless another surface owns the keyboard', () => {
    let owned = false;
    const { input, windowTarget, navToggled, cues } = mount(() => owned);
    for (const code of ['KeyB', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7']) {
      const press = key(code);
      windowTarget.dispatchEvent(press);
      expect(press.defaultPrevented, code).toBe(true);
    }
    expect(navToggled).toEqual([
      'build',
      'residents',
      'assistant',
      'statistics',
      'mission',
      'diplomacy',
      'knowledge',
    ]);
    owned = true;
    windowTarget.dispatchEvent(key('KeyB'));
    expect(navToggled).toHaveLength(7);
    expect(cues).toEqual([]);
    input.dispose();
  });

  it('leaves a field its letters, but takes an F-key from inside one', () => {
    const { input, windowTarget, navToggled } = mount();
    // A focused `<select>` keeps its letters: they run its own type-ahead, not a game action.
    const inList = key('KeyB');
    Object.defineProperty(inList, 'target', { value: new Dropdown() });
    windowTarget.dispatchEvent(inList);
    expect(inList.defaultPrevented).toBe(false);
    const typed = key('F2');
    Object.defineProperty(typed, 'target', { value: new TextField() });
    windowTarget.dispatchEvent(typed);
    windowTarget.dispatchEvent(key('KeyB'));
    expect(navToggled).toEqual(['residents', 'build']);
    input.dispose();
  });

  it('toggles the HUD on its key, from a text field too, but not under the system menu', () => {
    let owned = false;
    const { input, windowTarget, hudToggled } = mount(() => owned);
    const hide = key('F8');
    windowTarget.dispatchEvent(hide);
    expect(hudToggled()).toBe(1);
    expect(hide.defaultPrevented).toBe(true);
    const typed = key('F8');
    Object.defineProperty(typed, 'target', { value: new TextField() });
    windowTarget.dispatchEvent(typed);
    expect(hudToggled()).toBe(2);
    owned = true;
    windowTarget.dispatchEvent(key('F8'));
    expect(hudToggled()).toBe(2);
    input.dispose();
  });

  it("keeps the browser's own F-row actions off a running match, bound or not", () => {
    const { input, windowTarget, navToggled } = mount(() => true);
    const reload = key('F5');
    const unbound = key('F10');
    const fullscreen = key('F11');
    for (const press of [reload, unbound, fullscreen]) windowTarget.dispatchEvent(press);
    expect(reload.defaultPrevented).toBe(true);
    expect(unbound.defaultPrevented).toBe(true);
    expect(fullscreen.defaultPrevented).toBe(false);
    expect(navToggled).toEqual([]);
    input.dispose();
  });

  it('leaves Escape to a text field, a modal dialog and the system menu', () => {
    const { input, cues, arm, openWindow, closed, windowTarget } = mount(() => menuOpen);
    let menuOpen = false;
    arm();
    openWindow();
    const typed = key('Escape');
    Object.defineProperty(typed, 'target', { value: new TextField() });
    windowTarget.dispatchEvent(typed);
    const inDialog = key('Escape');
    Object.defineProperty(inDialog, 'target', { value: new DialogButton() });
    windowTarget.dispatchEvent(inDialog);
    menuOpen = true;
    windowTarget.dispatchEvent(key('Escape'));
    expect(cues).toEqual([]);
    expect(closed).toEqual([]);
    menuOpen = false;
    windowTarget.dispatchEvent(key('Escape'));
    expect(cues).toEqual(['fail']);
    input.dispose();
  });

  it('stops a consumed Escape before the listeners registered after it', () => {
    const { input, openWindow, windowTarget } = mount(undefined, () => true);
    let reached = 0;
    windowTarget.addEventListener('keydown', () => {
      reached++;
    });
    openWindow();
    windowTarget.dispatchEvent(key('Escape'));
    expect(reached).toBe(0);
    windowTarget.dispatchEvent(key('Escape'));
    expect(reached).toBe(1);
    input.dispose();
  });
});
