import type { UiCue } from '@open-northland/audio';
import { Container } from 'pixi.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_KEY_BINDINGS } from '../src/hud/keybindings.js';
import { createToolPanelInput, type HeldMode, type NotesInput } from '../src/hud/tool-panel/input.js';
import { buildToolPanelLayout, type ToolButtonId } from '../src/hud/tool-panel/layout.js';
import type { ToolWindows } from '../src/hud/tool-panel/windows.js';

/**
 * The tool panel's canvas input over a fake canvas and window: which press plays which GUI click. A
 * strip button confirms; a right-click or Esc that calls a held mode off fails; a strip button that
 * drops a held mode as a side effect plays only its own confirm.
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
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('HTMLElement', class {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function mount() {
  const canvas = new EventTarget() as unknown as HTMLCanvasElement;
  const layout = buildToolPanelLayout(1);
  const cues: UiCue[] = [];
  const pressed: ToolButtonId[] = [];
  const held = heldMode();
  const arm = (): void => {
    held.active = true;
  };
  const input = createToolPanelInput({
    canvas,
    container: new Container(),
    layout,
    toCanvas: (x, y) => ({ x, y }),
    windows: CLOSED_WINDOWS,
    notes: NO_NOTES,
    held: [held],
    bindings: DEFAULT_KEY_BINDINGS,
    // The buildings button drops a held mode before opening its menu, as `cancelsHeld` does.
    activateButton: (id) => {
      pressed.push(id);
      if (id === 'buildings') held.cancel();
    },
    togglePause: () => undefined,
    cue: (cue) => {
      cues.push(cue);
    },
  });
  const button = (id: ToolButtonId): { x: number; y: number } => {
    const rect = layout.buttons.find((b) => b.id === id)?.placed;
    if (rect === undefined) throw new Error(`no ${id} button`);
    return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
  };
  return { canvas, input, cues, pressed, held, arm, button, windowTarget };
}

describe('tool panel input clicks', () => {
  it('confirms a strip button press', () => {
    const { canvas, input, cues, pressed, button } = mount();
    const at = button('statistics');
    canvas.dispatchEvent(press(at.x, at.y));
    expect(pressed).toEqual(['statistics']);
    expect(cues).toEqual(['confirm']);
    input.dispose();
  });

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

  it('fails Esc only while something is held', () => {
    const { input, cues, arm, windowTarget } = mount();
    windowTarget.dispatchEvent(key('Escape'));
    expect(cues).toEqual([]);
    arm();
    windowTarget.dispatchEvent(key('Escape'));
    expect(cues).toEqual(['fail']);
    input.dispose();
  });

  it('plays only the confirm for a strip button that drops a held mode', () => {
    const { canvas, input, cues, held, arm, button } = mount();
    arm();
    const at = button('buildings');
    canvas.dispatchEvent(press(at.x, at.y));
    expect(held.isActive()).toBe(false);
    expect(cues).toEqual(['confirm']);
    input.dispose();
  });
});
