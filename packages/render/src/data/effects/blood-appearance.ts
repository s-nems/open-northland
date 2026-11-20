import type { components } from '@open-northland/sim';

export type BloodPalette = 0 | 1 | 2 | 3;
export interface BloodAppearance {
  readonly palette: BloodPalette;
  readonly volume: number;
}

/** The monster `[tribetype]` ids, as the data pack numbers them. */
const WERESNAKE_TRIBE = 5;
const WEREWOLF_TRIBE = 6;
const DRAGON_TRIBE = 42;

/** Authored presentation: red humans, dark red werewolves, slate-blue weresnakes and burgundy dragons. */
const CREATURE_BLOOD: readonly (BloodAppearance & { readonly tribe: number })[] = [
  { tribe: WERESNAKE_TRIBE, palette: 2, volume: 1 },
  { tribe: WEREWOLF_TRIBE, palette: 1, volume: 1.5 },
  { tribe: DRAGON_TRIBE, palette: 3, volume: 2.5 },
];
const HUMAN_BLOOD: BloodAppearance = { palette: 0, volume: 1 };

export function bloodAppearance(identity: components.SettlerIdentity | undefined): BloodAppearance {
  if (identity === undefined) return HUMAN_BLOOD;
  return CREATURE_BLOOD.find((rule) => rule.tribe === identity.tribe) ?? HUMAN_BLOOD;
}

/** Linear transforms shared by textures and procedural stains. Neutral adds an achromatic
 * fraction of the original red intensity, keeping the blue muted even along thin edges. */
export const BLOOD_PALETTES = [
  { swap: false, rgb: [1, 1, 1], neutral: 0 },
  { swap: false, rgb: [0.7, 0.8, 0.85], neutral: 0 },
  { swap: true, rgb: [0.55, 1.7, 0.34], neutral: 0.2 },
  { swap: false, rgb: [0.65, 0.8, 2.1], neutral: 0 },
] as const;
