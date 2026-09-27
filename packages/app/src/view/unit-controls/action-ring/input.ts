import type { UiCue } from '@open-northland/audio';
import {
  type ActionCommand,
  type ActionOrderId,
  type ActionRingLayout,
  hitTestActionRing,
} from '../../../hud/action-ring/index.js';
import { messages } from '../../../i18n/index.js';
import type { MenuMode } from './types.js';

/**
 * The controller owns no state: every getter reads the mount's live closure, and the order and mode
 * callbacks are the mount's seams.
 */
export interface ActionRingInputContext {
  readonly tooltip: HTMLElement;
  /** Client (CSS) point to canvas px, the space the layout and every hit-test work in. */
  readonly toCanvas: (clientX: number, clientY: number) => { x: number; y: number };
  readonly getMode: () => MenuMode;
  /** True for the ring face, false for the DOM list. */
  readonly isRingVisible: () => boolean;
  readonly getLayout: () => ActionRingLayout;
  readonly getTargets: () => readonly number[];
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
  /** A left press on a ring button. */
  press(command: ActionCommand, event: MouseEvent): void;
  /** The cursor over a ring button (its event) or off every one (null): the button's name beside it. */
  hover(command: ActionCommand | null, event: MouseEvent | null): void;
}

export const createActionRingInput = (ctx: ActionRingInputContext): ActionRingInput => {
  const { tooltip, toCanvas } = ctx;

  return {
    claimsPointer: (clientX, clientY) => {
      if (ctx.getMode() === 'closed' || !ctx.isRingVisible()) return false;
      const { x, y } = toCanvas(clientX, clientY);
      // Only button squares are claimed, so a click in the gap between them still reaches world picking
      // and the settler stays selectable through the open menu.
      return hitTestActionRing(ctx.getLayout(), x, y) !== null;
    },
    press(command, event): void {
      if (ctx.getMode() !== 'menu' || !ctx.isRingVisible()) return;
      // The press is the ring's, never the world's or the panel's under it.
      event.preventDefault();
      event.stopPropagation();
      ctx.cue('confirm');
      if (command.id === 'changeProfession') {
        ctx.openJobWindow();
        return;
      }
      // The targets are read before closing: closing is what ends the session they belong to.
      const targets = ctx.getTargets();
      ctx.closeMenu();
      ctx.onCommand(command.id, targets);
    },
    hover(command, event): void {
      if (command === null || event === null || ctx.getMode() === 'closed') {
        tooltip.style.display = 'none';
        return;
      }
      tooltip.textContent = messages().actionRing[command.id];
      tooltip.style.left = `${event.clientX + 12}px`;
      tooltip.style.top = `${event.clientY - 22}px`;
      tooltip.style.display = 'block';
    },
  };
};
