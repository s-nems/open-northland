import type { UiCue } from '@open-northland/audio';
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
  /** The GUI click a picked row and the ✕ box confirm with. */
  readonly cue: (cue: UiCue) => void;
}

export interface ProfessionPicker {
  /** Reveal the window, showing unavailable professions with their reason. */
  show(unlocked: (jobType: number) => boolean, reason?: (jobType: number) => string): void;
  refresh(): void;
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
    cue: opts.cue,
  });
  let unlocked: ((jobType: number) => boolean) | undefined;
  let reason: ((jobType: number) => string) | undefined;
  let heldKey: string | null = null;
  const refresh = (): void => {
    const permits = unlocked;
    if (permits === undefined) return;
    const rows = opts.professions.map((entry) => ({
      entry,
      blocked:
        entry.kind === 'header' || permits(entry.jobType) ? undefined : (reason?.(entry.jobType) ?? ''),
    }));
    const key = JSON.stringify(rows.map((row) => row.blocked));
    if (key === heldKey) return;
    heldKey = key;
    const scroll = window_.scrollTop();
    window_.clearList();
    for (const { entry, blocked } of rows) {
      if (entry.kind === 'header') {
        window_.addGroup(entry.label);
        continue;
      }
      window_.addRow(
        entry.label,
        () => {
          if (permits(entry.jobType)) opts.onPick(entry.jobType);
        },
        blocked,
      );
    }
    window_.setScrollTop(scroll);
  };
  return {
    show: (permits, blockedReason): void => {
      unlocked = permits;
      reason = blockedReason;
      heldKey = null;
      refresh();
      window_.show();
    },
    refresh,
    hide: () => {
      unlocked = undefined;
      window_.hide();
    },
    scrollTop: window_.scrollTop,
    setScrollTop: window_.setScrollTop,
    dispose: window_.dispose,
  };
}
