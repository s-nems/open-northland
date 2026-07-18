import type { Graphics } from 'pixi.js';
import { type ActionRingLayout, hitTestActionRing } from '../../../hud/action-ring-layout.js';
import { type Messages, messages } from '../../../i18n/index.js';
import type { MenuMode } from './types.js';

/** Hover highlight over the button under the cursor. */
const HOVER_TINT = 0xffffff;
const HOVER_ALPHA = 0.28;

/**
 * The live menu state + seams the pointer/keyboard controller reads and drives. The controller owns no
 * state of its own: `getMode`/`isRingVisible`/`getLayout`/`getTargets` read the mount's closure each event,
 * and the order/mode callbacks are the mount's command + state-machine seams. `hoverG`/`tooltip` are the
 * mount-owned hover visuals this controller clears via `hideTransient` and paints in the move handler.
 */
export interface ActionRingInputContext {
  readonly canvas: HTMLCanvasElement;
  /** The ring's effective scale (shared with layout); sizes the hover highlight's corner radius. */
  readonly scale: number;
  readonly hoverG: Graphics;
  readonly tooltip: HTMLElement;
  /** Client (CSS) point → canvas px — the space the layout and every hit-test work in. */
  readonly toCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  readonly getMode: () => MenuMode;
  /** Whether the ring container is currently visible (menu shown, not the DOM list). */
  readonly isRingVisible: () => boolean;
  readonly getLayout: () => ActionRingLayout;
  /** The settler ids a click's command applies to (the selected settlers, refreshed each frame). */
  readonly getTargets: () => readonly number[];
  /** Clear the hover highlight + tooltip. */
  readonly hideTransient: () => void;
  readonly onErectSignpost: (ids: readonly number[]) => void;
  readonly onMarry: (id: number) => void;
  readonly onAssignHouse: (id: number) => void;
  readonly onMakeChild: (id: number, sex: 'male' | 'female') => void;
  /** Swap the ring for the scrollable profession list window. */
  readonly openJobWindow: () => void;
  /** Fully close the whole menu (list + ring). */
  readonly closeMenu: () => void;
  /** Step back from the list to the ring. */
  readonly closeJobWindow: () => void;
}

export interface ActionRingInput {
  /** True when a client point is over a visible menu button — the input router asks before world picking. */
  claimsPointer(clientX: number, clientY: number): boolean;
  dispose(): void;
}

/**
 * Mount the settler ring's own pointer + keyboard listeners (registered before unit-controls' so a menu
 * click wins). Pure event → command/mode glue over {@link ActionRingInputContext}: it never touches sim
 * state or the menu's own mode/anchor storage, only reads them through the context and drives the seams.
 */
export const createActionRingInput = (ctx: ActionRingInputContext): ActionRingInput => {
  const { canvas, scale, hoverG, tooltip, toCanvas } = ctx;

  const claimsPointer = (clientX: number, clientY: number): boolean => {
    if (ctx.getMode() === 'closed' || !ctx.isRingVisible()) return false;
    const { x, y } = toCanvas(clientX, clientY);
    // Claim only actual button squares — a click in the gap between buttons (over the unit itself) still
    // reaches world picking, so the settler stays selectable/orderable through the open menu.
    return hitTestActionRing(ctx.getLayout(), x, y) !== null;
  };

  const onMouseDown = (e: MouseEvent): void => {
    if (ctx.getMode() !== 'menu' || !ctx.isRingVisible() || e.button !== 0) return;
    const { x, y } = toCanvas(e.clientX, e.clientY);
    const hit = hitTestActionRing(ctx.getLayout(), x, y);
    if (hit === null) return;
    // A menu click is the menu's — stop it reaching world picking (we register before unit-controls). This
    // consumes a placeholder click too, so an inert button never falls through to a move/attack order.
    e.stopImmediatePropagation();
    const targets = ctx.getTargets();
    const single = targets.length === 1 ? targets[0] : undefined;
    if (hit.kind === 'open-jobs') {
      ctx.openJobWindow(); // swap the ring for the scrollable profession list window
    } else if (hit.kind === 'erect-signpost') {
      // Arm the click-to-place mode for the selected scout(s) and close the ring — the next world click
      // places the signpost (the "Select place for signpost" flow of the original).
      const scouts = [...targets];
      ctx.closeMenu();
      ctx.onErectSignpost(scouts);
    } else if (hit.kind === 'marry' && single !== undefined) {
      ctx.onMarry(single);
      ctx.closeMenu(); // the order is issued — nothing left to do in the menu
    } else if (hit.kind === 'assign-house' && single !== undefined) {
      ctx.onAssignHouse(single);
      ctx.closeMenu(); // hands off to the click-a-house pick mode
    } else if (hit.kind === 'make-child' && single !== undefined) {
      ctx.onMakeChild(single, hit.sex);
      ctx.closeMenu();
    }
    // kind 'placeholder' — consumed above, but its action is not yet implemented (inert on this slice).
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

  // Escape backs out of the open profession list (the twin of a backdrop click / Space). It must stop here:
  // unit-controls also listens for Escape on `window` (to clear the selection), and we registered first — so
  // without stopImmediatePropagation an Escape over the list would also deselect the unit and close the whole
  // menu, when it should only step back to the ring with the unit still selected.
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && ctx.getMode() === 'jobs') {
      e.stopImmediatePropagation();
      ctx.closeJobWindow();
    }
  };

  // These listeners register before unit-controls' (this controller is mounted first). The `mouseleave`
  // clears a hover highlight/tooltip that would otherwise linger when the cursor leaves the canvas while
  // still over a button (no further `mousemove` fires to clear it).
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
