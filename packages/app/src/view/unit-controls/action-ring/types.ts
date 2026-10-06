import type { UiCue } from '@open-northland/audio';
import type { ContentSet } from '@open-northland/data';
import type { Camera } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { PickerEntry } from '../../../catalog/professions.js';
import type { UiString } from '../../../content/gui-gfx.js';
import type { ActionOrderId } from '../../../hud/action-ring/index.js';
import type { SelectionCentre } from './selection-centre.js';

/** Which face the menu shows: nothing, the default arms, or the profession picker. */
export type MenuMode = 'closed' | 'menu' | 'jobs';

export interface SettlerActionsOptions {
  readonly uiString: UiString;
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  /** The resolved HUD scale, multiplied into the menu geometry. May be fractional. */
  readonly uiscale: number;
  /** The caller memoizes the result per frame, so the open ring may ask every frame. */
  readonly selectionCentre: (snapshot: WorldSnapshot) => SelectionCentre | null;
  readonly professions: readonly PickerEntry[];
  /** Job roles are read off the running content, so buttons offer what the command accepts. */
  readonly content: ContentSet;
  /** Whether the picker should list `jobType` at all for the current selection. */
  readonly jobVisible: (ids: readonly number[], jobType: number) => boolean;
  /** Whether a selected settler may take `jobType` now (the `needforjob` tech tree, which `setJob`
   *  enforces sim-side as well). */
  readonly jobUnlocked: (ids: readonly number[], jobType: number) => boolean;
  readonly jobBlockedReason?: (ids: readonly number[], jobType: number) => string;
  readonly onSetJob: (ids: readonly number[], jobType: number) => void;
  /** Bumped when an answer the job gates read lands changed, so an open list redraws under one
   *  snapshot, as a paused game keeps. */
  readonly jobAnswersVersion: () => number;
  /** One ring button was clicked for the selected settlers; the menu has already closed. */
  readonly onCommand: (id: ActionOrderId, targets: readonly number[]) => void;
  /** The GUI click every pressed ring button and picked profession confirms with. */
  readonly cue: (cue: UiCue) => void;
}

export interface SettlerActions {
  /** Lay the menu out on its pinned anchor and rebuild which buttons the live selection offers. */
  update(camera: Camera, snapshot: WorldSnapshot): void;
  /** Toggle/step the menu (Space): closed→menu, jobs→menu, menu→closed. */
  toggle(pin?: RingPin): void;
  /** Open the profession list directly for the live selected settlers. */
  openProfessions(targets: readonly number[]): void;
  /** Open the default action menu, idempotent to the `menu` face. `pin` pins it on that client point;
   *  omitted, it pins on the centroid. */
  open(pin?: RingPin): void;
  close(): void;
  /** True when a client point is over a visible menu button; the input router asks before world picking. */
  claimsPointer(clientX: number, clientY: number): boolean;
  /** Consume Escape while the menu is up: the job list steps back to the ring, the ring closes, and
   *  the selection and any open window stay. unit-controls consults this before its own Escape
   *  fallback, so listener order never matters. */
  handleEscape(): boolean;
  state(): SettlerActionsState;
  restore(state: SettlerActionsState): void;
  dispose(): void;
}

/** Where the menu pins: a client (CSS) point, as the original pins on the cursor at bring-up, and for a
 *  press from the settler panel while the trade window is open that window's client right edge, which
 *  the whole menu keeps right of so no arm opens under it. */
export interface RingPin {
  readonly x: number;
  readonly y: number;
  readonly keepRightOf?: number;
}

/** The pin in screen (canvas) px; `leftBound` is the window's edge, null for the open screen. */
export interface RingAnchor {
  readonly x: number;
  readonly y: number;
  readonly leftBound: number | null;
}

export interface SettlerActionsState {
  readonly mode: MenuMode;
  readonly anchor: RingAnchor | null;
  readonly pickerScrollTop: number;
}
