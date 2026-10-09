import type { UnitVariant } from '@open-northland/data';
import type { ByJobTable, SettlerCharacter } from '@open-northland/render';

/** Preserve the source table for scenario units while composing the playable seat's complete looks. */
export function withPlayableCharacters(
  table: ByJobTable<SettlerCharacter>,
  variants: readonly UnitVariant[],
): ByJobTable<SettlerCharacter> {
  const rules = variants.filter((rule) => !rule.scenario && rule.graphicsJobType !== undefined);
  if (rules.length === 0) return table;
  const byJob = { ...table.byJob };
  const byWeaponGood = { ...table.byWeaponGood };
  for (const rule of rules) {
    const source = table.byJob[rule.jobType];
    const replacement = rule.graphicsJobType === undefined ? undefined : table.byJob[rule.graphicsJobType];
    if (source === undefined || replacement === undefined) continue;
    const look: SettlerCharacter = {
      ...replacement,
      paletteJobType: rule.graphicsJobType,
      ...(replacement.variants === undefined
        ? {}
        : {
            variants: replacement.variants.map((variant) => ({
              ...variant,
              paletteJobType: rule.graphicsJobType,
            })),
          }),
    };
    byJob[rule.jobType] = look;
    for (const [good, character] of Object.entries(byWeaponGood)) {
      if (character === source) byWeaponGood[Number(good)] = look;
    }
  }
  return { ...table, playable: { ...table, byJob, byWeaponGood } };
}
