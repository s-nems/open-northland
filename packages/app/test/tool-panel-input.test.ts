import type { UiCue } from '@open-northland/audio';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS } from '../src/hud/keybindings.js';
import { createToolPanelInput, type HeldMode, type NotesInput } from '../src/hud/tool-panel/input.js';
import type { ToolWindows } from '../src/hud/tool-panel/windows.js';

/**
 * The tool panel's canvas and key input over a fake canvas and window: which press plays which GUI
 * click, and the Escape ladder (a held mode, then the open central window, then nothing).
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
    placeBanner: (): void => undefined,
  };
  return mode;
}

const NO_NOTES: NotesInput = {
  windowClaims: () => false,
  handleWindowClick: () => false,
  handleNoteClick: () => false,
  handleHover: () => undefined,
};

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

function mount(keyboardOwned?: () => boolean) {
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  const cues: UiCue[] = [];
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
    notes: NO_NOTES,
    held: [held],
    bindings: DEFAULT_KEY_BINDINGS,
    closeWindow: () => {
      if (!windowOpen) return false;
      windowOpen = false;
      closed.push(1);
      return true;
    },
    ...(keyboardOwned !== undefined ? { keyboardOwned } : {}),
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
  it('cancels a held mode first, then closes the open window, then leaves the press alone', () => {
    const { input, cues, held, arm, openWindow, closed, windowTarget } = mount();
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
    const { input, openWindow, windowTarget } = mount();
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
