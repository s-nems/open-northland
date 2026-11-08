import type { ConstructionPriority } from '@open-northland/sim';
import type { HouseholdEffect } from '../../details-panel/model/index.js';
import type { KeybindingAction } from '../../keybindings.js';
import type { GoodIconPainter } from '../good-art.js';
import type { TipChip } from '../parts/tip-layer.js';
import type { SettlerPanelActions } from '../settler-panel/actions.js';

/**
 * What the building panel's orders ask for. The owner checks the viewer's ownership before a command
 * leaves; the panel only decides which control was pressed.
 */
export interface BuildingPanelActions {
  /** Raise `building` to the `target` tier; the next one when omitted. */
  readonly upgrade: (building: number, target?: number) => void;
  readonly cancelUpgrade: (building: number) => void;
  /** Ask the player whether to raze the building named `name`, then raze it. */
  readonly demolish: (building: number, name: string) => void;
  /** Arm the planting of `building`'s rally flag: the next click on the ground plants or moves it. */
  readonly armRallyPoint: (building: number) => void;
  /** Take `building`'s rally flag away. */
  readonly clearRallyPoint: (building: number) => void;
  readonly setAlarm: (building: number, on: boolean) => void;
  /** Raise or call off the alarm in every shelter of `building`'s owner. */
  readonly setAlarmEverywhere: (building: number, on: boolean) => void;
  /** Stand `garrison` down from the tower and select them, so the next click sends them on. */
  readonly releaseGarrison: (building: number, garrison: readonly number[]) => void;
  /** Allow or forbid a household ware in every home of `player`. */
  readonly setHouseholdGoodUse: (player: number, effect: HouseholdEffect, allowed: boolean) => void;
  /** Keep `amount` units of `goodType` across every storehouse of `player`; zero keeps none. */
  readonly setStorageMinimum: (player: number, goodType: number, amount: number) => void;
  /** Mark or unmark `goodType` as priority in `building`, whose porters then fetch it. */
  readonly setStorePriority: (building: number, goodType: number, priority: boolean) => void;
  /** Prioritize the construction site `building`; `normal` clears its priority. */
  readonly setConstructionPriority: (building: number, priority: ConstructionPriority) => void;
}

/** The central windows the panel opens. */
export interface BuildingPanelWindows {
  /** The residents window, listing the people who could take `jobType`. */
  readonly residentsFor: (jobType: number) => void;
  /** Knowledge on the building type's entry. */
  readonly knowledge: (typeId: number) => void;
}

/** What the panel reads besides its model. */
export interface BuildingPanelDeps {
  readonly plane: HTMLElement;
  readonly icons: GoodIconPainter;
  readonly tooltip: TipChip;
  /** The view and selection presses the settler panel makes too. */
  readonly actions: Pick<SettlerPanelActions, 'centre' | 'select' | 'show' | 'clearSelection'>;
  readonly building: BuildingPanelActions;
  readonly windows: BuildingPanelWindows;
  /** The key bound to `action`, as the player reads it. */
  readonly keyLabel: (action: KeybindingAction) => string;
  /** The owner's buildings of the shown one's type, ascending; an index read. */
  readonly buildingPeers: (building: number) => readonly number[];
}
