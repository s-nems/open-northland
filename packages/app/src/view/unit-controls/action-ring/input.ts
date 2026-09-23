import type { UiCue } from '@open-northland/audio';
import type { Graphics } from 'pixi.js';
import {
  type ActionOrderId,
  type ActionRingLayout,
  hitTestActionRing,
  isPendingAction,
} from '../../../hud/action-ring/index.js';
import { messages } from '../../../i18n/index.js';
import type { MenuMode } from './types.js';

const HOVER_TINT = 0xffffff;
const HOVER_ALPHA = 0.28;

/**
 * The controller owns no state: every getter reads the mount's live closure, the order and mode
 * callbacks are the mount's seams, and `hoverG`/`tooltip` are mount-owned visuals it paints.
 */
export interface ActionRingInputContext {
  readonly canvas: HTMLCanvasElement;
  /** Effective ring scale, shared with the layout. */
  readonly scale: number;
  readonly hoverG: Graphics;
  readonly tooltip: HTMLElement;
  /** Client (CSS) point to canvas px, the space the layout and every hit-test work in. */
  readonly toCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  readonly getMode: () => MenuMode;
  /** True for the ring face, false for the DOM list. */
  readonly isRingVisible: () => boolean;
  readonly getLayout: () => ActionRingLayout;
  readonly getTargets: () => readonly number[];
  /** Clear the hover highlight and tooltip. */
  readonly hideTransient: () => void;
  readonly onCommand: (id: ActionOrderId, targets: readonly number[]) => void;
  /** The GUI click a pressed button confirms with. */
  readonly cue: (cue: UiCue) => void;
  readonly openJobWindow: () => void;
  /** Close both faces, list and ring. */
  readonly closeMenu: () => void;
}

export interface ActionRingInput {
  /** True when a client point is over a visible menu button; the input router asks before world picking. */
  claimsPointer(clientX: number, clientY: number): boolean;
  dispose(): void;
}

/**
 * Mount the settler ring's pointer and keyboard listeners, registered before unit-controls' so a menu
 * click wins.
 */
export const createActionRingInput = (ctx: ActionRingInputContext): ActionRingInput => {
  const { canvas, scale, hoverG, tooltip, toCanvas } = ctx;

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    if (ctx.getMode() === 'closed' || !ctx.isRingVisible()) return false;
    const { x, y } = toCanvas(clientX, clientY);
    // Only button squares are claimed, so a click in the gap between them still reaches world picking
    // and the settler stays selectable through the open menu.
    return hitTestActionRing(ctx.getLayout(), x, y) !== null;
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (ctx.getMode() !== 'menu' || !ctx.isRingVisible() || e.button !== 0) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const hit = hitTestActionRing(ctx.getLayout(), x, y);
    if (hit === null) return;
    e.stopImmediatePropagation(); // the click is the ring's, never world picking's
    if (isPendingAction(hit.id)) return; // drawn for fidelity, with no order behind it yet
    ctx.cue('confirm');
    if (hit.id === 'changeProfession') {
      e.preventDefault();
      ctx.openJobWindow();
      return;
    }
    // The targets are read before closing: closing is what ends the session they belong to.
    const targets = ctx.getTargets();
    ctx.closeMenu();
    ctx.onCommand(hit.id, targets);
  };

  const onMouseMove = (e: MouseEvent): void => {
    if (ctx.getMode() === 'closed' || !ctx.isRingVisible()) {
      hoverG.clear();
      tooltip.style.display = 'none';
      return;
    }
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const layout = ctx.getLayout();
    const hit = hitTestActionRing(layout, x, y);
    hoverG.clear();
    if (hit === null) {
      tooltip.style.display = 'none';
      return;
    }
    const placed = layout.buttons.find((p) => p.command === hit);
    if (placed !== undefined) {
      hoverG
        .roundRect(placed.rect.x, placed.rect.y, placed.rect.w, placed.rect.h, Math.max(2, 3 * scale))
        .fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
    }
    const label = messages().actionRing[hit.id];
    tooltip.textContent = isPendingAction(hit.id) ? `${label} (${messages().actionRingPending})` : label;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY - 22}px`;
    tooltip.style.display = 'block';
  };

  // `mouseleave` clears a highlight the cursor would otherwise strand: leaving the canvas over a button
  // fires no further `mousemove`.
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', ctx.hideTransient);

  return {
    claimsPointer,
    dispose: (): void => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', ctx.hideTransient);
    },
  };
};
