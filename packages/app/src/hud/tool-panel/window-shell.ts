import { type Container, Graphics } from 'pixi.js';
import { contains, type Rect } from '../geometry.js';
import type { TextRun } from '../text-run.js';

/**
 * The open/close plumbing every tool-panel pop-up window repeats: an open flag, the vector text runs, and
 * one `Graphics` buffer parented under the panel's window container. Each window keeps its own layout,
 * rebuild, and hit-test; the shell owns only what they all share, so a new window (see
 * `docs/tickets/app/hud-missing-windows.md`) inherits the lifecycle instead of re-implementing it.
 *
 * A window with extra draw layers (the build menu's tiled `back` + hover `Graphics`) creates them itself
 * around the shell — the shell's `graphics`/`runs` are the shared frame + labels, not the whole window.
 */
export interface WindowShell {
  /** The shared frame/chrome buffer (window with extra layers draws those on its own Graphics). */
  readonly graphics: Graphics;
  /** The window's vector text runs — the controller pushes what it builds; `clear()` destroys them. */
  readonly runs: TextRun[];
  isOpen(): boolean;
  setOpen(open: boolean): void;
  /** Destroy the text runs and clear the shared graphics buffer (leaves the open flag untouched). */
  clear(): void;
  /** Open and the point is inside the window's current rect (a null rect ⇒ not drawn ⇒ no claim). */
  claims(rect: Rect | null, x: number, y: number): boolean;
}

export function createWindowShell(container: Container): WindowShell {
  let opened = false;
  const runs: TextRun[] = [];
  const graphics = new Graphics();
  container.addChild(graphics);

  const clear = (): void => {
    for (const r of runs) r.destroy();
    runs.length = 0;
    graphics.clear();
  };

  return {
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
