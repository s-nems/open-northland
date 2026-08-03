import type { ContentSet } from '@open-northland/data';
import type { Camera } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { PickerEntry } from '../../../catalog/professions.js';
import type { SelectionCentre } from './selection-centre.js';

/** Which face the menu shows: nothing, the default arms, or the profession picker. */
export type MenuMode = 'closed' | 'menu' | 'jobs';

export interface SettlerActionsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** UI scale from `?uiscale=`, multiplied into the menu geometry. May be fractional. */
  readonly uiscale: number;
  /** The caller memoizes the result per frame, so the open ring may ask every frame. */
  readonly selectionCentre: (snapshot: WorldSnapshot) => SelectionCentre | null;
  readonly professions: readonly PickerEntry[];
  /** Job roles are read off the running content, so buttons offer what the command accepts. */
  readonly content: ContentSet;
  /** Whether the whole selection may take `jobType` now (the `needforjob` tech tree, which `setJob`
   *  enforces sim-side as well). */
  readonly jobUnlocked: (ids: readonly number[], jobType: number) => boolean;
  readonly onSetJob: (ids: readonly number[], jobType: number) => void;
  /** Arm the erect-signpost click-to-place mode for the selected scout(s). */
  readonly onErectSignpost: (ids: readonly number[]) => void;
  /** Arm the attack-move pick mode; it sends whatever is selected when the world click lands, and a
   *  selection change cancels it. */
  readonly onAttackMove: () => void;
  readonly onMarry: (id: number) => void;
  /** Arm the click-a-house pick mode. */
  readonly onAssignHouse: (id: number) => void;
  readonly onMakeChild: (id: number, sex: 'male' | 'female') => void;
}

export interface SettlerActions {
  /** Lay the menu out on its pinned anchor and rebuild which buttons the live selection offers. */
  update(camera: Camera, snapshot: WorldSnapshot): void;
  /** Toggle/step the menu (Space): closed→menu, jobs→menu, menu→closed. */
  toggle(): void;
  /**
   * Open the default action menu, idempotent to the `menu` face. `atClient` pins it on that client
   * (CSS) point, as the original pins on the cursor at bring-up; omitted, it pins on the centroid.
   */
  open(atClient?: { readonly x: number; readonly y: number }): void;
  close(): void;
  /** True when a client point is over a visible menu button; the input router asks before world picking. */
  claimsPointer(clientX: number, clientY: number): boolean;
  dispose(): void;
}
