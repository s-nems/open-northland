import { type Container, Graphics } from 'pixi.js';
import { HOVER_ALPHA, HOVER_TINT } from '../chrome.js';
import { isActionHotkey } from '../hotkeys.js';
import type { KeyBindings } from '../keybindings.js';
import { hitTestToolPanel, type ToolButtonId, type ToolPanelLayout } from './layout.js';
import type { ToolWindows } from './windows.js';

/** Every branch here that consumes a press stops it reaching world picking behind the panel. */

/** A mode the panel holds until the player commits or cancels it; while active it claims the whole canvas. */
export interface HeldMode {
  isActive(): boolean;
  cancel(): void;
  /** True when this mode took the press; the first claimer wins. */
  handleClick(clientX: number, clientY: number): boolean;
  placeBanner(): void;
}

export interface ToolPanelInputDeps {
  readonly canvas: HTMLCanvasElement;
  readonly container: Container;
  readonly layout: ToolPanelLayout;
  readonly toCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  readonly windows: ToolWindows;
  readonly held: readonly HeldMode[];
  readonly bindings: KeyBindings;
  readonly activateButton: (id: ToolButtonId) => void;
  readonly togglePause: () => void;
  readonly deferToOverlay?: (clientX: number, clientY: number) => boolean;
}

export interface ToolPanelInput {
  dispose(): void;
}

export function createToolPanelInput(deps: ToolPanelInputDeps): ToolPanelInput {
  const { canvas, layout, toCanvas, windows, held } = deps;
  const anyHeld = (): boolean => held.some((m) => m.isActive());
  const hoverG = new Graphics();
  deps.container.addChild(hoverG);

  const onMouseDown = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);

    // Right button cancels an active placement or good drop; otherwise it is a world order for unit controls.
    if (e.button === 2) {
      if (anyHeld()) {
        e.preventDefault();
        // Order-independent with unit controls: when it runs first the still-held claim makes it
        // defer; when it runs later, stopping the event keeps the now-clear claim from reading the
        // press as a world move order.
        e.stopImmediatePropagation();
        for (const mode of held) mode.cancel();
        return;
      }
      // macOS delivers Ctrl+left-click as button 2, so with nothing to cancel it falls through as the
      // primary press and the Ctrl coarse step still works.
      if (!e.ctrlKey) return;
    } else if (e.button !== 0) return;
    // A higher overlay covers this point, so its own handler takes the press instead.
    if (deps.deferToOverlay?.(e.clientX, e.clientY) === true) return;

    // Priority: strip button > open pop-up > a held mode.
    const btn = hitTestToolPanel(layout, x, y);
    let consumed = btn !== null;
    if (btn !== null) deps.activateButton(btn);
    else consumed = windows.handleClick(x, y, { bigStep: e.ctrlKey || e.metaKey });
    for (const mode of held) {
      if (consumed) break;
      consumed = mode.handleClick(e.clientX, e.clientY);
    }
    if (consumed) e.stopImmediatePropagation();
  };

  let hover: ToolButtonId | null = null;
  const onMouseMove = (e: MouseEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    windows.handleHover(x, y);
    const next = hitTestToolPanel(layout, x, y);
    if (next === hover) return;
    hover = next;
    hoverG.clear();
    if (hover === null) return;
    const rect = layout.buttons.find((b) => b.id === hover)?.placed;
    if (rect !== undefined) {
      hoverG.rect(rect.x, rect.y, rect.w, rect.h).fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
    }
  };

  // A wheel over an open pop-up belongs to that window; its default would scroll the page behind the
  // canvas.
  const onWheel = (e: WheelEvent): void => {
    const { x, y } = toCanvas(e.clientX, e.clientY);
    if (windows.handleWheel(x, y, e.deltaY)) e.preventDefault();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    // The mission sheet holds the game paused and covers the middle of the screen, so Escape dismisses
    // it first and the pause hotkey waits until it is gone.
    const sheet = windows.byId.mission;
    if (e.code === 'Escape') {
      if (sheet.isOpen()) {
        sheet.close();
        return;
      }
      for (const mode of held) {
        if (mode.isActive()) mode.cancel();
      }
    }
    // Each pause toggle re-rasterizes the strip, so key repeat must not flicker it.
    if (isActionHotkey(e, deps.bindings, 'pauseToggle') && !sheet.isOpen()) deps.togglePause();
  };

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKeyDown);

  return {
    dispose(): void {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      hoverG.destroy();
    },
  };
}
