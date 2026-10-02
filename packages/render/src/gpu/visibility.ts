import type { Container } from 'pixi.js';

export interface StashedVisibility {
  readonly child: { visible: boolean };
  readonly wasVisible: boolean;
}

/**
 * Hide every child but `except`. A child holding `except` (a depth band of the sprite layer) stays
 * visible and hides its own other children instead. `into` lets a per-frame caller reuse a retained
 * array; it is cleared up front, so a skipped restore cannot corrupt the next stash.
 */
export function stashHidden(
  children: readonly Container[],
  except: Container,
  into: StashedVisibility[] = [],
): StashedVisibility[] {
  into.length = 0;
  hideAllBut(children, except, into);
  return into;
}

function hideAllBut(children: readonly Container[], except: Container, into: StashedVisibility[]): void {
  for (const child of children) {
    if (child === except) continue;
    if (holds(child, except)) {
      hideAllBut(child.children, except, into);
      continue;
    }
    into.push({ child, wasVisible: child.visible });
    child.visible = false;
  }
}

function holds(ancestor: Container, node: Container): boolean {
  for (let parent = node.parent; parent !== null; parent = parent.parent)
    if (parent === ancestor) return true;
  return false;
}

/** Restore exactly the visibilities {@link stashHidden} changed. */
export function restoreStash(stash: readonly StashedVisibility[]): void {
  for (const { child, wasVisible } of stash) child.visible = wasVisible;
}
