import type { Camera } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { PickerEntry } from '../../../catalog/professions.js';

/** Which face the menu is showing: nothing, the default arms, or the profession picker. */
export type MenuMode = 'closed' | 'menu' | 'jobs';

export interface SettlerActionsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** UI scale (from `?uiscale=`, shared with the tool panel); the menu geometry is multiplied by it. May be fractional. */
  readonly uiscale: number;
  /** The grouped profession menu the picker offers (group headers + one-click profession rows). */
  readonly professions: readonly PickerEntry[];
  /** Issue a `setJob` on every selected settler (the one-way command seam). */
  readonly onSetJob: (ids: readonly number[], jobType: number) => void;
  /** Arm the erect-signpost click-to-place mode for the selected scout(s) (the scout menu's button). */
  readonly onErectSignpost: (ids: readonly number[]) => void;
  /** Issue a `marry` order on the (single) selected settler. */
  readonly onMarry: (id: number) => void;
  /** Arm the click-a-house pick mode for the (single) selected settler. */
  readonly onAssignHouse: (id: number) => void;
  /** Issue a `makeChild` order of the chosen sex on the (single) selected woman. */
  readonly onMakeChild: (id: number, sex: 'male' | 'female') => void;
}

export interface SettlerActions {
  /**
   * Per-frame: lay the menu out on its pinned anchor and show/hide it, rebuilding which buttons the
   * selection's live state offers. Reads the settlers' positions from the frame's already-built snapshot;
   * only runs a scan while the menu is open and a settler is selected, so a closed menu costs nothing.
   */
  update(camera: Camera, snapshot: WorldSnapshot, selection: ReadonlySet<number>): void;
  /** Toggle/step the menu (Space): closed→menu, jobs→menu (back out of the picker), menu→closed. */
  toggle(): void;
  /**
   * Open the default action menu — idempotent to the `menu` face. `atClient` is the client (CSS) point to
   * pin the menu on: the right-click path passes the cursor (what the original stores at bring-up); omit it
   * and the menu pins on the selection's centroid instead (the Space path, which has no cursor).
   */
  open(atClient?: { readonly x: number; readonly y: number }): void;
  /** Force-close (e.g. on a selection clear). */
  close(): void;
  /** True when a client point is over a visible menu button — the input router asks before world picking. */
  claimsPointer(clientX: number, clientY: number): boolean;
  dispose(): void;
}
