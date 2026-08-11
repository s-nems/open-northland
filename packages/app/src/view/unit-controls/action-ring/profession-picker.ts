import type { PickerEntry } from '../../../catalog/professions.js';
import type { UiFont } from '../../../content/ui-font.js';
import { uiLabel } from '../../../i18n/index.js';
import { createPickerWindow } from '../picker-window.js';

export interface ProfessionPickerOptions {
  readonly professions: readonly PickerEntry[];
  readonly uiFont: UiFont;
  readonly onPick: (jobType: number) => void;
  /** The window was dismissed without a pick: the ✕ box or a backdrop click. */
  readonly onDismiss: () => void;
}

export interface ProfessionPicker {
  /** Reveal the window, offering only the professions `unlocked` admits. */
  show(unlocked: (jobType: number) => boolean): void;
  hide(): void;
  scrollTop(): number;
  setScrollTop(top: number): void;
  dispose(): void;
}

/** The window is appended to `document.body` hidden and filled per open. */
export function createProfessionPicker(opts: ProfessionPickerOptions): ProfessionPicker {
  const window_ = createPickerWindow({
    uiFont: opts.uiFont,
    title: uiLabel('changeProfession'),
    onDismiss: opts.onDismiss,
  });
  return {
    show: (unlocked: (jobType: number) => boolean): void => {
      // A header is emitted only once one of its rows survives the filter, so a fully-locked group
      // leaves no trace; rows before the first header form a headerless leading group.
      window_.clearList();
      let pendingHeader: string | null = null;
      for (const entry of opts.professions) {
        if (entry.kind === 'header') {
          pendingHeader = entry.label;
          continue;
        }
        if (!unlocked(entry.jobType)) continue;
        if (pendingHeader !== null) {
          window_.addGroup(pendingHeader);
          pendingHeader = null;
        }
        window_.addRow(entry.label, () => opts.onPick(entry.jobType));
      }
      window_.show();
    },
    hide: window_.hide,
    scrollTop: window_.scrollTop,
    setScrollTop: window_.setScrollTop,
    dispose: window_.dispose,
  };
}
