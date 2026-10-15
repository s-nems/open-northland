import type { HypertextCallback } from '@open-northland/data';
import type { MissionGroupKind } from '@open-northland/sim';

/**
 * What a briefing's `<onscreencallback:kind,a,b>` asks of the main view: kind 1000 centres it on
 * half-cell node (a, b), 1001, 1002 and 1003 on the mean point of the humans, vehicles or houses
 * stamped with mission id `a`. Kind 2000 speaks a clip instead (`callbackVoice`) and moves no view,
 * though it still takes the pending slot.
 */
export type BriefingViewTarget =
  | { readonly kind: 'node'; readonly hx: number; readonly hy: number }
  | { readonly kind: 'group'; readonly group: MissionGroupKind; readonly id: number };

const CENTRE_ON_NODE = 1000;
const CENTRE_ON_GROUP: Readonly<Record<number, MissionGroupKind | undefined>> = {
  1001: 'human',
  1002: 'vehicle',
  1003: 'house',
};

/** The view a callback centres, or null for a kind that moves no view. */
export function callbackView([kind, a, b]: HypertextCallback['args']): BriefingViewTarget | null {
  if (kind === CENTRE_ON_NODE) return { kind: 'node', hx: a, hy: b };
  const group = CENTRE_ON_GROUP[kind];
  return group === undefined ? null : { kind: 'group', group, id: a };
}

/**
 * The callbacks whose marker the shown spread shows, in reading order: inside a page window, in its
 * visible column. Each page window holds the whole flow, so a callback is reported once per window it
 * shows in. Reads the layout: it runs on a layout change, never per frame.
 */
export function shownCallbacks(spread: HTMLElement): number[] {
  const shown: number[] = [];
  for (const marker of spread.querySelectorAll<HTMLElement>('.on-book__callback')) {
    const win = marker.closest<HTMLElement>('.on-book__window');
    if (win === null || win.classList.contains('on-book__window--blank')) continue;
    const at = marker.getBoundingClientRect();
    const box = win.getBoundingClientRect();
    const inColumn = at.left < box.right && at.right > box.left;
    const onPage = at.top >= box.top && at.top <= box.bottom;
    if (inColumn && onPage) shown.push(Number(marker.dataset.callback));
  }
  return shown;
}
