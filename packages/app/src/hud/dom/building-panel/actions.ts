import type { UiCue } from '@open-northland/audio';
import type { HouseholdEffect } from '../../details-panel/model/index.js';
import type { GoodIconPainter } from '../good-art.js';
import type { TipChip } from '../parts/tip-layer.js';
import type { SettlerPanelActions } from '../settler-panel/actions.js';

/**
 * What the building panel's orders ask for. The owner checks the viewer's ownership before a command
 * leaves; the panel only decides which control was pressed.
 */
export interface BuildingPanelActions {
  readonly upgrade: (building: number) => void;
  readonly cancelUpgrade: (building: number) => void;
  readonly demolish: (building: number) => void;
  readonly setAlarm: (building: number, on: boolean) => void;
  /** Allow or forbid a household ware in every home of `player`. */
  readonly setHouseholdGoodUse: (player: number, effect: HouseholdEffect, allowed: boolean) => void;
}

/** What the panel reads besides its model. */
export interface BuildingPanelDeps {
  readonly plane: HTMLElement;
  readonly icons: GoodIconPainter;
  readonly tooltip: TipChip;
  /** The GUI click a press that only arms a confirmation makes. */
  readonly cue: (cue: UiCue) => void;
  /** Wall clock in ms: how long an armed demolition waits for its confirming press. */
  readonly now: () => number;
  /** The view and selection presses the settler panel makes too. */
  readonly actions: Pick<SettlerPanelActions, 'centre' | 'select' | 'show' | 'clearSelection'>;
  readonly building: BuildingPanelActions;
  /** The owner's buildings of the shown one's type, ascending; an index read. */
  readonly buildingPeers: (building: number) => readonly number[];
}
