import type { FogMaskAnswer } from '@open-northland/sim';

/**
 * The viewer's fog as the runtime last received it. The sim's fog generation counts every vision
 * group's changes, so most of its bumps leave the viewer's own mask as it was; posting those would
 * copy the mask across and have every fog reader on the main thread rebuild for nothing.
 */
export class FogPosts {
  /** A copy of the last mask passed on, since a posted mask's buffer is transferred away; undefined
   *  before the first. */
  private last: FogMaskAnswer | null | undefined = undefined;

  /** Whether `answer` reads differently from the last answer passed on, its generation aside; a
   *  changed answer becomes the last. */
  changed(answer: FogMaskAnswer | null): boolean {
    if (this.last !== undefined && sameFog(this.last, answer)) return false;
    this.last = answer === null ? null : { ...answer, mask: answer.mask?.slice() ?? null };
    return true;
  }
}

function sameFog(a: FogMaskAnswer | null, b: FogMaskAnswer | null): boolean {
  if (a === null || b === null) return a === b;
  if (
    a.player !== b.player ||
    a.mode !== b.mode ||
    a.cellsWide !== b.cellsWide ||
    a.cellsHigh !== b.cellsHigh
  ) {
    return false;
  }
  const am = a.mask;
  const bm = b.mask;
  if (am === null || bm === null) return am === bm;
  if (am.length !== bm.length) return false;
  for (let i = 0; i < am.length; i++) if (am[i] !== bm[i]) return false;
  return true;
}
