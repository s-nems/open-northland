import type { PickerEntry } from '../../catalog/professions.js';
import { bcp47Tag, messages } from '../../i18n/index.js';
import type { ChoiceGroup } from './choice-window.js';

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
