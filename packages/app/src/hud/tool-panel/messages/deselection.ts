import type { MessageFeed } from './feed.js';

/** The seat's unit selection as the strip reads it. */
export interface UnitSelectionView {
  /** One set mutated in place, so a frame keeps its own copy to compare against. */
  selectedIds(): ReadonlySet<number>;
  /** Bumps on every change to the set. */
  selectionVersion(): number;
}

/**
 * Dismisses a settler's notes the frame it leaves the selection. Byte evidence: the owned `the original`
 * unselect path (VA 0x4b5041 -> 0x4b5712 -> 0x4b273a) removes every message about the human with no
 * history entry; the the original names it `Message_RemoveAllForHuman`. `feed` is read per call because
 * a HUD rescale swaps the feed.
 */
export function createDeselectionDismisser(feed: () => MessageFeed): (selection: UnitSelectionView) => void {
  let seen: { readonly version: number; readonly ids: ReadonlySet<number> } | null = null;
  return (selection) => {
    const version = selection.selectionVersion();
    if (seen !== null && seen.version === version) return;
    const current = selection.selectedIds();
    if (seen !== null) {
      for (const id of seen.ids) if (!current.has(id)) feed().removeSettler(id);
    }
    seen = { version, ids: new Set(current) };
  };
}
