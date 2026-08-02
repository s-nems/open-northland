import type { PickerEntry } from '../../../catalog/professions.js';
import type { UiFont } from '../../../content/ui-font.js';
import { uiLabel } from '../../../i18n/index.js';
import { createPickerWindow } from '../picker-window.js';

/**
 * The "Zmiana zawodu" profession picker over the shared centred pick window (`../picker-window.ts`).
 * It is the window half of the settler action menu ({@link import('./settler-actions.js')}): that module
 * owns the ring + the `closed`/`menu`/`jobs` mode machine and drives {@link ProfessionPicker.show}/`hide`;
 * this module fills the window from the grouped menu per open and turns a row click into
 * {@link ProfessionPickerOptions.onPick} and the ✕ box / backdrop click into
 * {@link ProfessionPickerOptions.onDismiss}.
 */

export interface ProfessionPickerOptions {
  /** The grouped profession menu the picker offers (group headers + one-click profession rows). */
  readonly professions: readonly PickerEntry[];
  /** The bundled serif UI face (shared with the details panel); the picker composes it over its fallback. */
  readonly uiFont: UiFont;
  /** A profession row was clicked - the caller issues the `setJob` command and closes the menu. */
  readonly onPick: (jobType: number) => void;
  /** The window was dismissed without a pick (the ✕ box or a backdrop click). */
  readonly onDismiss: () => void;
}

export interface ProfessionPicker {
  /** Reveal the backdrop + window (the caller has already switched the menu to its `jobs` mode),
   *  offering only the professions `unlocked` admits - the tech tree's discovered set for the current
   *  selection. A group whose every row is filtered out hides its header too. */
  show(unlocked: (jobType: number) => boolean): void;
  /** Hide the backdrop + window. */
  hide(): void;
  /** Remove the backdrop + window from the DOM. */
  dispose(): void;
}

/**
 * Build the profession-picker window and return its show/hide/dispose handle. The window is appended to
 * `document.body` hidden and filled per open; the caller drives it in step with the action-menu mode.
 */
export function createProfessionPicker(opts: ProfessionPickerOptions): ProfessionPicker {
  const window_ = createPickerWindow({
    uiFont: opts.uiFont,
    title: uiLabel('changeProfession'),
    onDismiss: opts.onDismiss,
  });
  return {
    show: (unlocked: (jobType: number) => boolean): void => {
      // Rebuilt per open, because the discovered set grows as the tribe trains. The grouped menu renders
      // top to bottom: a dim separator per category, then its unlocked profession rows. A header is only
      // emitted once one of its rows survives the filter, so a fully-locked group leaves no trace; rows
      // before the first header (the Cywil row) form a headerless leading group.
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
    dispose: window_.dispose,
  };
}
