/** One child's visibility remembered across a temporary hide, so the restore puts back exactly what the
 *  hide changed rather than making everything visible. */
export interface StashedVisibility {
  readonly child: { visible: boolean };
  readonly wasVisible: boolean;
}

/**
 * Hide every child but `except`, recording each hidden child's prior visibility for {@link restoreStash}.
 * `into` lets a per-frame caller reuse a retained array; it is cleared up front, so a skipped restore
 * cannot corrupt the next stash.
 */
export function stashHidden(
  children: readonly { visible: boolean }[],
  except: { visible: boolean },
  into: StashedVisibility[] = [],
): StashedVisibility[] {
  into.length = 0;
  for (const child of children) {
    if (child === except) continue;
    into.push({ child, wasVisible: child.visible });
    child.visible = false;
  }
  return into;
}

/** Restore exactly the visibilities {@link stashHidden} changed. */
export function restoreStash(stash: readonly StashedVisibility[]): void {
  for (const { child, wasVisible } of stash) child.visible = wasVisible;
}
