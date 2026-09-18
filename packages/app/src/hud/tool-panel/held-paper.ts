import type { Paper } from '@open-northland/sim';
import { messages } from '../../i18n/index.js';
import type { PlacementStrip } from '../dom/placement-strip.js';
import type { PanelContext } from './context.js';
import type { HeldMode } from './input.js';

/**
 * The place-any paper the construction window was opened for. Held, with the strip up, until the
 * window's next pick takes it; Esc, a right or world click, or the window closing drop it back into
 * the list unspent.
 */
export interface HeldPaperController extends HeldMode {
  hold(paper: Paper): void;
  /** The held paper, released to the pick that spends it; null when none is held. */
  take(): Paper | null;
  held(): Paper | null;
}

export function createHeldPaperController(ctx: PanelContext, strip: PlacementStrip): HeldPaperController {
  let paper: Paper | null = null;
  const drop = (): void => {
    paper = null;
    strip.clear();
  };
  return {
    hold: (held): void => {
      paper = held;
      const copy = messages().hud.construction;
      strip.show({ label: copy.heldPaper, hint: copy.heldPaperHint });
    },
    take: (): Paper | null => {
      const taken = paper;
      drop();
      return taken;
    },
    held: () => paper,
    isActive: () => paper !== null,
    cancel: drop,
    handleClick: (): boolean => {
      if (paper === null) return false;
      ctx.cue('fail'); // a world click with a paper in hand calls the hold off
      drop();
      return true;
    },
  };
}
