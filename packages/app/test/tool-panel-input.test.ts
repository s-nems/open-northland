import type { UiCue } from '@open-northland/audio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS } from '../src/hud/keybindings.js';
import { createToolPanelInput, type HeldMode } from '../src/hud/tool-panel/input.js';
import type { ToolWindows } from '../src/hud/tool-panel/windows.js';

/**
 * The tool panel's canvas and key input over a fake canvas and window: which press plays which GUI
 * click, the Escape ladder (a held mode, then the open central window, then the unit controls' turn,
 * then the game menu) and the menu and construction hotkeys.
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
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('Element', DialogButton);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stand-ins for the DOM classes the keyboard-owner guard probes. */
class TextField {}
class DialogButton {
  closest(selector: string): object | null {
    return selector === '[aria-modal="true"]' ? this : null;
  }
}

function mount(keyboardOwned?: () => boolean, escapeClaimed?: () => boolean) {
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  const cues: UiCue[] = [];
  let menuOpened = 0;
  let constructionToggled = 0;
  let residentsToggled = 0;
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
    toggleConstruction: () => {
      constructionToggled++;
    },
    toggleResidents: () => {
      residentsToggled++;
    },
    togglePause: () => undefined,
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
    constructionToggled: (): number => constructionToggled,
    residentsToggled: (): number => residentsToggled,
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
      toggleConstruction: () => undefined,
      toggleResidents: () => undefined,
      togglePause: () => undefined,
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

  it('toggles the construction window on its key, unless another surface owns the keyboard', () => {
    let owned = false;
    const { input, windowTarget, constructionToggled, cues } = mount(() => owned);
    const build = key('KeyB');
    windowTarget.dispatchEvent(build);
    expect(constructionToggled()).toBe(1);
    expect(build.defaultPrevented).toBe(true);
    owned = true;
    windowTarget.dispatchEvent(key('KeyB'));
    expect(constructionToggled()).toBe(1);
    expect(cues).toEqual([]);
    input.dispose();
  });

  it('toggles the residents window on F7, from inside a text field too, but not under the system menu', () => {
    let owned = false;
    const { input, windowTarget, residentsToggled } = mount(() => owned);
    const open = key('F7');
    windowTarget.dispatchEvent(open);
    expect(residentsToggled()).toBe(1);
    expect(open.defaultPrevented).toBe(true);
    const typed = key('F7');
    Object.defineProperty(typed, 'target', { value: new TextField() });
    windowTarget.dispatchEvent(typed);
    expect(residentsToggled()).toBe(2);
    owned = true;
    windowTarget.dispatchEvent(key('F7'));
    expect(residentsToggled()).toBe(2);
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
