import { FOG_STATE, type FogView, scanChangedBytes, systems } from '@open-northland/sim';

/** The viewer's sight, as the memories of changes made in the fog ask it. */
export interface Sight {
  /** Whether the viewer currently watches the cell of half-cell node (hx, hy). */
  seesNode(hx: number, hy: number): boolean;
  /** The fog cell index of half-cell node (hx, hy), the key {@link newlyVisible} lists. */
  cellOfNode(hx: number, hy: number): number;
  /** Bumps whenever {@link seesNode} may answer differently. */
  readonly revision: number;
  /** The cells that turned visible at the latest {@link revision}; null when that is unknown and every
   *  cell may have. */
  readonly newlyVisible: readonly number[] | null;
}

/**
 * Changes waiting for the viewer's sight, keyed by `K` and filed by fog cell, so a sight change rechecks
 * the changes under the cells it opened rather than every change still waiting.
 */
export class UnseenChanges<K> {
  private readonly cellOf = new Map<K, number>();
  private readonly byCell = new Map<number, Set<K>>();
  private checkedAt: number | null = null;

  get size(): number {
    return this.cellOf.size;
  }

  keys(): IterableIterator<K> {
    return this.cellOf.keys();
  }

  add(key: K, cell: number): void {
    this.delete(key);
    this.cellOf.set(key, cell);
    let keys = this.byCell.get(cell);
    if (keys === undefined) {
      keys = new Set();
      this.byCell.set(cell, keys);
    }
    keys.add(key);
  }

  delete(key: K): void {
    const cell = this.cellOf.get(key);
    if (cell === undefined) return;
    this.cellOf.delete(key);
    const keys = this.byCell.get(cell);
    keys?.delete(key);
    if (keys?.size === 0) this.byCell.delete(cell);
  }

  /** The changes `sight` may have opened since the last call: none while it holds, those under its newly
   *  visible cells after one step, every change after a missed step or an unknown one. */
  opened(sight: Sight): K[] {
    const last = this.checkedAt;
    this.checkedAt = sight.revision;
    if (last === sight.revision || this.cellOf.size === 0) return [];
    const cells = last !== null && sight.revision === last + 1 ? sight.newlyVisible : null;
    if (cells === null) return [...this.cellOf.keys()];
    const opened: K[] = [];
    for (const cell of cells) for (const key of this.byCell.get(cell) ?? []) opened.push(key);
    return opened;
  }
}

/** The cell index of a node while no view gives the grid. */
const NO_CELL = -1;

/** The cells a step from view `was` to `view` turned visible, read off the two views' mask bytes; null
 *  when the step cannot be diffed (fog turned on or off, another seat, mode or grid, a view over live
 *  state), so every cell may have. */
function openedCells(was: FogView | null, view: FogView | null): readonly number[] | null {
  if (was === null || view === null || was.cells === undefined || view.cells === undefined) return null;
  if (was.player !== view.player || was.mode !== view.mode || was.cellsWide !== view.cellsWide) return null;
  if (was.cells.length !== view.cells.length) return null;
  const opened: number[] = [];
  const wide = view.cellsWide;
  scanChangedBytes(was.cells, view.cells, (cell) => {
    const cx = cell % wide;
    if (view.stateAt(cx, (cell - cx) / wide) === FOG_STATE.VISIBLE) opened.push(cell);
    return true;
  });
  return opened;
}

/** The sight of one viewer as its fog views follow one another; a null view is fog off, which sees
 *  everything. */
export class ViewSight implements Sight {
  private view: FogView | null = null;
  /** Whether a view was set: until then nothing reads as seen. */
  private known = false;
  private revisionValue = 0;
  private opened: readonly number[] | null = null;

  set(view: FogView | null): void {
    const was = this.view;
    const changed =
      view === null || was === null
        ? view !== was
        : view.generation !== was.generation || view.player !== was.player || view.mode !== was.mode;
    if (changed || !this.known) {
      this.revisionValue++;
      this.opened = this.known ? openedCells(was, view) : null;
    }
    this.known = true;
    this.view = view;
  }

  /** Fog off watches everything, and nothing is watched before the first view is set, so a change
   *  made then waits for it. */
  seesNode(hx: number, hy: number): boolean {
    if (!this.known) return false;
    if (this.view === null) return true;
    const { cx, cy } = systems.cellOfNode(hx, hy);
    return this.view.stateAt(cx, cy) === FOG_STATE.VISIBLE;
  }

  cellOfNode(hx: number, hy: number): number {
    if (this.view === null) return NO_CELL;
    const { cx, cy } = systems.cellOfNode(hx, hy);
    return cy * this.view.cellsWide + cx;
  }

  get revision(): number {
    return this.revisionValue;
  }

  get newlyVisible(): readonly number[] | null {
    return this.opened;
  }
}
