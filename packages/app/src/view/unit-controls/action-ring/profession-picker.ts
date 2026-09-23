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
  /** Reveal the window, listing visible professions and marking unavailable ones with their reason. */
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

interface ProfessionPickerRow {
  readonly entry: PickerEntry;
  readonly blocked?: string;
}

/** The picker hides jobs the caller does not want listed, and only keeps headers above visible rows. */
export function professionPickerRows(
  professions: readonly PickerEntry[],
  visible: (jobType: number) => boolean,
  unlocked: (jobType: number) => boolean,
  reason?: (jobType: number) => string,
): ProfessionPickerRow[] {
  const rows: ProfessionPickerRow[] = [];
  let pendingHeader: { readonly kind: 'header'; readonly label: string } | undefined;
  for (const entry of professions) {
    if (entry.kind === 'header') {
      pendingHeader = entry;
      continue;
    }
    if (!visible(entry.jobType)) continue;
    if (pendingHeader !== undefined) {
      rows.push({ entry: pendingHeader });
      pendingHeader = undefined;
    }
    const blocked = unlocked(entry.jobType) ? undefined : (reason?.(entry.jobType) ?? '');
    rows.push({
      entry,
      ...(blocked !== undefined ? { blocked } : {}),
    });
  }
  return rows;
}

/** The window is appended to `document.body` hidden and filled per open. */
export function createProfessionPicker(opts: ProfessionPickerOptions): ProfessionPicker {
  const window_ = createPickerWindow({
    uiFont: opts.uiFont,
    title: uiLabel('changeProfession'),
    onDismiss: opts.onDismiss,
    cue: opts.cue,
  });
  let visible: ((jobType: number) => boolean) | undefined;
  let unlocked: ((jobType: number) => boolean) | undefined;
  let reason: ((jobType: number) => string) | undefined;
  let heldKey: string | null = null;
  const refresh = (): void => {
    const shown = visible;
    const permits = unlocked;
    if (shown === undefined || permits === undefined) return;
    const rows = professionPickerRows(opts.professions, shown, permits, reason);
    const key = JSON.stringify(
      rows.map((row) =>
        row.entry.kind === 'header'
          ? ['header', row.entry.label]
          : ['profession', row.entry.jobType, row.blocked ?? null],
      ),
    );
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
    show: (shown, permits, blockedReason): void => {
      visible = shown;
      unlocked = permits;
      reason = blockedReason;
      heldKey = null;
      refresh();
      window_.show();
    },
    refresh,
    hide: () => {
      visible = undefined;
      unlocked = undefined;
      window_.hide();
    },
    scrollTop: window_.scrollTop,
    setScrollTop: window_.setScrollTop,
    dispose: window_.dispose,
  };
}
