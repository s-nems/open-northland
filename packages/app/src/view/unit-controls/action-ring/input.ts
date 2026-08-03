import type { Graphics } from 'pixi.js';
import { type ActionRingLayout, hitTestActionRing } from '../../../hud/action-ring-layout.js';
import { type Messages, messages } from '../../../i18n/index.js';
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
  readonly onErectSignpost: (ids: readonly number[]) => void;
  readonly onAttackMove: () => void;
  readonly onMarry: (id: number) => void;
  readonly onAssignHouse: (id: number) => void;
  readonly onMakeChild: (id: number, sex: 'male' | 'female') => void;
  readonly openJobWindow: () => void;
  /** Close both faces, list and ring. */
  readonly closeMenu: () => void;
  /** Step back from the list to the ring. */
  readonly closeJobWindow: () => void;
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
    // Stop the click reaching world picking, including on an inert placeholder button.
    e.stopImmediatePropagation();
    const targets = ctx.getTargets();
    const single = targets.length === 1 ? targets[0] : undefined;
    if (hit.kind === 'open-jobs') {
      ctx.openJobWindow();
    } else if (hit.kind === 'erect-signpost') {
      // The next world click places the signpost (the original's "Select place for signpost" flow).
      const scouts = [...targets];
      ctx.closeMenu();
      ctx.onErectSignpost(scouts);
    } else if (hit.kind === 'attack-move') {
      ctx.closeMenu();
      ctx.onAttackMove();
    } else if (hit.kind === 'marry' && single !== undefined) {
      ctx.onMarry(single);
      ctx.closeMenu();
    } else if (hit.kind === 'assign-house' && single !== undefined) {
      ctx.onAssignHouse(single);
      ctx.closeMenu();
    } else if (hit.kind === 'make-child' && single !== undefined) {
      ctx.onMakeChild(single, hit.sex);
      ctx.closeMenu();
    }
    // The 'placeholder' kind is consumed above and carries no action.
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
    const placed = layout.buttons.find((p) => p.button === hit);
    if (placed !== undefined) {
      hoverG
        .roundRect(placed.rect.x, placed.rect.y, placed.rect.w, placed.rect.h, Math.max(2, 3 * scale))
        .fill({ color: HOVER_TINT, alpha: HOVER_ALPHA });
    }
    tooltip.textContent = messages().actionRing[hit.id as keyof Messages['actionRing']] ?? hit.id;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY - 22}px`;
    tooltip.style.display = 'block';
  };

  // unit-controls also listens for Escape on `window` to clear the selection, and this listener is
  // registered first, so stopping propagation keeps the unit selected while stepping back to the ring.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && ctx.getMode() === 'jobs') {
      e.stopImmediatePropagation();
      ctx.closeJobWindow();
    }
  };

  // `mouseleave` clears a highlight the cursor would otherwise strand: leaving the canvas over a button
  // fires no further `mousemove`.
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseleave', ctx.hideTransient);
  window.addEventListener('keydown', onKeyDown);

  return {
    claimsPointer,
    dispose: (): void => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', ctx.hideTransient);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
};
