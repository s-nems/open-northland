import { Container } from 'pixi.js';
import type { TextRun } from '../text-run.js';
import type { PanelContext } from './context.js';

/**
 * The on-screen info lines a map script writes for the player: up to five, right-aligned against
 * the top-right corner, stacked at the original's line pitch. A reading of the original's static
 * window, which prints each line white over a dark outline; the outline is not drawn here.
 */

/** Inset (design px) from the right screen edge, and the first line's top. */
const RIGHT_INSET = 8;
const TOP_INSET = 4;
/** Line pitch (design px) for a script line; the original's multiplayer goal lines sit tighter. */
const LINE_PITCH = 12;
/** The HUD's body size; the original prints these in its 10 px GUI font (approximation). */
const LINE_PX = 11;

export interface InfoLinesOverlay {
  /** Replace the shown lines; identical text leaves the runs alone. */
  set(lines: readonly string[]): void;
  /** Per-frame hook: re-place on a resize. */
  refresh(): void;
  dispose(): void;
}

export function createInfoLinesOverlay(ctx: PanelContext, parent: Container): InfoLinesOverlay {
  const container = new Container();
  parent.addChild(container);
  let runs: TextRun[] = [];
  let shown: readonly string[] = [];
  let screenKey = '';

  const place = (): void => {
    const { width, height } = ctx.screen();
    screenKey = `${width}x${height}`;
    const { scale } = ctx;
    runs.forEach((run, i) => {
      const x = width - (RIGHT_INSET + run.width) * scale;
      const y = (TOP_INSET + i * LINE_PITCH) * scale;
      run.place(Math.round(x), Math.round(y), scale, width, height);
    });
  };

  const clear = (): void => {
    for (const run of runs) run.destroy();
    runs = [];
  };

  return {
    set(lines) {
      if (lines.length === shown.length && lines.every((line, i) => line === shown[i])) return;
      shown = [...lines];
      clear();
      runs = shown.map((line) => {
        const run = ctx.makeText(line, 'white', LINE_PX);
        container.addChild(run.container);
        return run;
      });
      place();
    },
    refresh() {
      const { width, height } = ctx.screen();
      if (runs.length > 0 && `${width}x${height}` !== screenKey) place();
    },
    dispose() {
      clear();
      container.destroy({ children: true });
    },
  };
}
