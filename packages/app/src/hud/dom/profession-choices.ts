import { LEADING_PROFESSION, type PickerEntry, professionGoods } from '../../catalog/professions.js';
import { compareLabels, messages } from '../../i18n/index.js';
import type { ChoiceGroup, ChoiceRow } from './choice-window.js';

export function professionChoices(
  professions: readonly PickerEntry[],
  visible: (jobType: number) => boolean,
  unlocked: (jobType: number) => boolean,
  reason?: (jobType: number) => string,
): ChoiceGroup[] {
  const groups: { label: string; rows: ChoiceRow[] }[] = [];
  for (const entry of professions) {
    if (entry.kind === 'header') {
      groups.push({ label: entry.label, rows: [] });
      continue;
    }
    const group = groups.at(-1);
    if (group === undefined) throw new Error(`professionChoices: job ${entry.jobType} has no group header`);
    if (!visible(entry.jobType)) continue;
    const goods = professionGoods(entry.jobType);
    group.rows.push({
      key: String(entry.jobType),
      label: entry.label,
      ...(goods.length === 0 ? {} : { goodIds: goods }),
      ...(unlocked(entry.jobType)
        ? {}
        : { reason: reason?.(entry.jobType) ?? messages().hud.technologyExperience }),
    });
  }
  const compare = compareLabels();
  const leader = String(LEADING_PROFESSION);
  const rank = (row: ChoiceRow): number => (row.key === leader ? 0 : 1);
  for (const part of groups) part.rows.sort((a, b) => rank(a) - rank(b) || compare(a.label, b.label));
  return groups.filter((part) => part.rows.length > 0);
}
