import type { UiCue } from '@open-northland/audio';
import type { PickerEntry } from '../../../catalog/professions.js';
import { createChoiceWindow } from '../../../hud/dom/choice-window.js';
import type { GoodIconPainter } from '../../../hud/dom/good-art.js';
import { professionChoices } from '../../../hud/dom/profession-choices.js';
import { uiLabel } from '../../../i18n/index.js';
import type { CameraGestures } from '../../camera/index.js';

export interface ProfessionPickerOptions {
  readonly professions: readonly PickerEntry[];
  readonly scale: number;
  readonly camera: CameraGestures;
  readonly onPick: (jobType: number) => void;
  readonly onDismiss: () => void;
  readonly cue: (cue: UiCue) => void;
  /** Paints each trade's good before its name; absent lists the names alone. */
  readonly icons?: GoodIconPainter;
}
export interface ProfessionPicker {
  show(
    visible: (jobType: number) => boolean,
    unlocked: (jobType: number) => boolean,
    reason?: (jobType: number) => string,
  ): void;
  refresh(): void;
  hide(): void;
  scrollTop(): number;
  setScrollTop(top: number): void;
  dispose(): void;
}

export function createProfessionPicker(opts: ProfessionPickerOptions): ProfessionPicker {
  let visible: ((jobType: number) => boolean) | undefined;
  let unlocked: ((jobType: number) => boolean) | undefined;
  let reason: ((jobType: number) => string) | undefined;
  const dialog = createChoiceWindow({
    title: uiLabel('changeProfession'),
    camera: opts.camera,
    scale: opts.scale,
    cue: opts.cue,
    ...(opts.icons === undefined ? {} : { icons: opts.icons }),
    onDismiss: opts.onDismiss,
    onPick: (key) => {
      const job = Number(key);
      if (visible?.(job) && unlocked?.(job)) opts.onPick(job);
    },
  });
  const refresh = (): void => {
    if (visible === undefined || unlocked === undefined) return;
    dialog.update(professionChoices(opts.professions, visible, unlocked, reason));
  };
  return {
    show: (shown, permits, blockedReason) => {
      visible = shown;
      unlocked = permits;
      reason = blockedReason;
      refresh();
      dialog.show();
    },
    refresh,
    hide: () => {
      visible = undefined;
      unlocked = undefined;
      dialog.hide();
    },
    scrollTop: dialog.scrollTop,
    setScrollTop: dialog.setScrollTop,
    dispose: dialog.dispose,
  };
}
