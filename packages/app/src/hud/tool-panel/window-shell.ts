import { Container, Graphics } from 'pixi.js';
import { contains, type Rect } from '../geometry.js';
import type { TextRun } from '../text-run.js';

/** What every tool-panel pop-up presents to the panel, whatever it draws inside: a strip button toggles it,
 *  and the panel probes it for pointer input. */
export interface ToolWindow {
  isOpen(): boolean;
  toggle(): void;
  close(): void;
  /** True when the point is over the open window (the HUD claims it before world picking). */
  claims(x: number, y: number): boolean;
  /** Route a canvas-space click; true when this window consumed it. */
  handleClick(x: number, y: number): boolean;
}

/**
 * The open/close plumbing every tool-panel pop-up window repeats: an open flag, the vector text runs, and
 * one `Graphics` buffer, all inside one container of the window's own. Each window keeps its own layout,
 * rebuild, and hit-test; the shell owns only what they all share, so a new window inherits the
 * lifecycle instead of re-implementing it.
 *
 * A window with extra draw layers (the tabbed lists' tiled `back` + hover `Graphics`) creates them itself
 * inside `container` - the shell's `graphics`/`runs` are the shared frame + labels, not the whole window.
 */
export interface WindowShell {
  /** Everything this window draws, frame and labels alike: the panel mounts these in draw order, so a
   *  rebuild's re-appended runs cannot outrank a later window's frame. */
  readonly container: Container;
  /** The shared frame/chrome buffer, and `container`'s first child - a window's extra layers order
   *  themselves around it. */
  readonly graphics: Graphics;
  /** The window's vector text runs - the controller pushes what it builds; `clear()` destroys them. */
  readonly runs: TextRun[];
  isOpen(): boolean;
  setOpen(open: boolean): void;
  /** Destroy the text runs and clear the shared graphics buffer (leaves the open flag untouched). */
  clear(): void;
  /** Open and the point is inside the window's current rect (a null rect ⇒ not drawn ⇒ no claim). */
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
