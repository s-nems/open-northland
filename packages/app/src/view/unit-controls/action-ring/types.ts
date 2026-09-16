import type { ContentSet } from '@open-northland/data';
import type { Camera } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { PickerEntry } from '../../../catalog/professions.js';
import type { ActionOrderId } from '../../../hud/action-ring/index.js';
import type { SelectionCentre } from './selection-centre.js';

/** Which face the menu shows: nothing, the default arms, or the profession picker. */
export type MenuMode = 'closed' | 'menu' | 'jobs';

export interface SettlerActionsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The resolved HUD scale, multiplied into the menu geometry. May be fractional. */
  readonly uiscale: number;
  /** The caller memoizes the result per frame, so the open ring may ask every frame. */
  readonly selectionCentre: (snapshot: WorldSnapshot) => SelectionCentre | null;
  readonly professions: readonly PickerEntry[];
  /** Job roles are read off the running content, so buttons offer what the command accepts. */
  readonly content: ContentSet;
  /** Whether the whole selection may take `jobType` now (the `needforjob` tech tree, which `setJob`
   *  enforces sim-side as well). */
  readonly jobBlockedReason?: (ids: readonly number[], jobType: number) => string;
  readonly jobUnlocked: (ids: readonly number[], jobType: number) => boolean;
  readonly onSetJob: (ids: readonly number[], jobType: number) => void;
  /** One ring button was clicked for the selected settlers; the menu has already closed. */
  readonly onCommand: (id: ActionOrderId, targets: readonly number[]) => void;
}

export interface SettlerActions {
  /** Lay the menu out on its pinned anchor and rebuild which buttons the live selection offers. */
  update(camera: Camera, snapshot: WorldSnapshot): void;
  /** Toggle/step the menu (Space): closed→menu, jobs→menu, menu→closed. */
  toggle(atClient?: { readonly x: number; readonly y: number }): void;
  /** Open the profession list directly for the live selected settlers. */
  openProfessions(targets: readonly number[]): void;
  /**
   * Open the default action menu, idempotent to the `menu` face. `atClient` pins it on that client
   * (CSS) point, as the original pins on the cursor at bring-up; omitted, it pins on the centroid.
   */
  open(atClient?: { readonly x: number; readonly y: number }): void;
  close(): void;
  /** True when a client point is over a visible menu button; the input router asks before world picking. */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** Consume Escape while the job list is open: closes it back to the ring and keeps the selection.
   *  unit-controls consults this before its own Escape fallback, so listener order never matters. */
  handleEscape(): boolean;
  state(): SettlerActionsState;
  restore(state: SettlerActionsState): void;
  dispose(): void;
}

export interface SettlerActionsState {
  readonly mode: MenuMode;
  readonly anchor: { readonly x: number; readonly y: number } | null;
  readonly pickerScrollTop: number;
}
