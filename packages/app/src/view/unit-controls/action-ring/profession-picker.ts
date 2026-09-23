import type { UiCue } from '@open-northland/audio';
import type { PickerEntry } from '../../../catalog/professions.js';
import { type ChoiceGroup, createChoiceWindow } from '../../../hud/dom/choice-window.js';
import { bcp47Tag, messages, uiLabel } from '../../../i18n/index.js';

export interface ProfessionPickerOptions {
  readonly professions: readonly PickerEntry[];
  readonly scale: number;
  readonly onPick: (jobType: number) => void;
  readonly onDismiss: () => void;
  readonly cue: (cue: UiCue) => void;
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

export function professionChoices(
  professions: readonly PickerEntry[],
  visible: (jobType: number) => boolean,
  unlocked: (jobType: number) => boolean,
  reason?: (jobType: number) => string,
): ChoiceGroup[] {
  const groups: { label: string; rows: { key: string; label: string; reason?: string }[] }[] = [];
  let group: (typeof groups)[number] = { label: messages().hud.choiceBasic, rows: [] };
  groups.push(group);
  for (const entry of professions) {
    if (entry.kind === 'header') {
      group = { label: entry.label, rows: [] };
      groups.push(group);
      continue;
    }
    if (!visible(entry.jobType)) continue;
    group.rows.push({
      key: String(entry.jobType),
      label: entry.label,
      ...(unlocked(entry.jobType)
        ? {}
        : { reason: reason?.(entry.jobType) ?? messages().hud.technologyExperience }),
    });
  }
  // The leading ungrouped civilian, gathering and transport rows form the compact basic group.
  const basics = groups.splice(0, 3);
  groups.unshift({ label: messages().hud.choiceBasic, rows: basics.flatMap((part) => part.rows) });
  const compare = new Intl.Collator(bcp47Tag(), { sensitivity: 'base' }).compare;
  for (const part of groups) part.rows.sort((a, b) => compare(a.label, b.label));
  return groups.filter((part) => part.rows.length > 0);
}

export function createProfessionPicker(opts: ProfessionPickerOptions): ProfessionPicker {
  let visible: ((jobType: number) => boolean) | undefined;
  let unlocked: ((jobType: number) => boolean) | undefined;
  let reason: ((jobType: number) => string) | undefined;
  const window = createChoiceWindow({
    title: uiLabel('changeProfession'),
    scale: opts.scale,
    cue: opts.cue,
    onDismiss: opts.onDismiss,
    onPick: (key) => {
      const job = Number(key);
      if (visible?.(job) && unlocked?.(job)) opts.onPick(job);
    },
  });
  const refresh = (): void => {
    if (visible === undefined || unlocked === undefined) return;
    window.update(professionChoices(opts.professions, visible, unlocked, reason));
  };
  return {
    show: (shown, permits, blockedReason) => {
      visible = shown;
      unlocked = permits;
      reason = blockedReason;
      refresh();
      window.show();
    },
    refresh,
    hide: () => {
      visible = undefined;
      unlocked = undefined;
      window.hide();
    },
    scrollTop: window.scrollTop,
    setScrollTop: window.setScrollTop,
    dispose: window.dispose,
  };
}
