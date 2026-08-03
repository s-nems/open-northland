import { Container, Graphics } from 'pixi.js';
import { contains, type Rect } from '../geometry.js';
import type { TextRun } from '../text-run.js';

/** The modifier keys a click carried. */
export interface ClickModifiers {
  /** Ctrl or Cmd was held. */
  readonly bigStep: boolean;
}

/** What every tool-panel pop-up presents to the panel: a strip button toggles it, and the panel probes
 *  it for pointer input. */
export interface ToolWindow {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
  /** True when the point is over the open window (the HUD claims it before world picking). */
  claims(x: number, y: number): boolean;
  /** Route a canvas-space click; true when this window consumed it. */
  handleClick(x: number, y: number, mods?: ClickModifiers): boolean;
}

/**
 * The open/close plumbing shared by every tool-panel pop-up: an open flag, the text runs, and one
 * `Graphics` buffer inside a container of the window's own. Each window keeps its own layout, rebuild,
 * hit-test, and any extra draw layers it parents inside `container`.
 */
export interface WindowShell {
  /** The panel mounts these in draw order, so a rebuild's re-appended runs cannot outrank a later
   *  window's frame. */
  readonly container: Container;
  /** The shared frame buffer and `container`'s first child; extra layers order themselves around it. */
  readonly graphics: Graphics;
  /** The controller pushes the runs it builds; `clear()` destroys them. */
  readonly runs: TextRun[];
  isOpen(): boolean;
  setOpen(open: boolean): void;
  /** Destroy the text runs and clear the shared graphics buffer; the open flag is untouched. */
  clear(): void;
  /** True when open and the point is inside the current rect; a null rect means nothing drawn. */
  claims(rect: Rect | null, x: number, y: number): boolean;
}

export function createWindowShell(parent: Container): WindowShell {
  let opened = false;
  const runs: TextRun[] = [];
  const container = new Container();
  parent.addChild(container);
  const graphics = new Graphics();
  container.addChild(graphics);

  const clear = (): void => {
    for (const r of runs) r.destroy();
    runs.length = 0;
    graphics.clear();
  };

  return {
    container,
    graphics,
    runs,
    isOpen: () => opened,
    setOpen: (open) => {
      opened = open;
    },
    clear,
    claims: (rect, x, y) => opened && rect !== null && contains(rect, x, y),
  };
}
