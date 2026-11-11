/** The assistant's switch rows: the "give …" grants (gear, drinks and charms), one that swaps held tools
 *  for better granted ones, one that sends school graduates straight to a free workplace and one that lets
 *  gatherers move their flags after the resources. */
export type AssistantGrantId = GiveSwitchId | 'upgradeTools' | 'postGraduates' | 'moveFlags';

export type GiveSwitchId =
  | 'giveBoots'
  | 'giveWoodenTools'
  | 'giveIronTools'
  | 'giveMead'
  | 'giveFoodPotions'
  | 'giveStaminaPotions'
  | 'giveHealingPotions'
  | 'giveFoodAmulet'
  | 'giveStaminaAmulet'
  | 'giveStrengthAmulet'
  | 'giveDefenseAmulet'
  | 'giveCriticalHitAmulet'
  | 'giveSpeedAmulet';

export const GRANT_IDS: readonly AssistantGrantId[] = [
  'giveBoots',
  'giveWoodenTools',
  'giveIronTools',
  'giveMead',
  'giveFoodPotions',
  'giveStaminaPotions',
  'giveHealingPotions',
  'giveFoodAmulet',
  'giveStaminaAmulet',
  'giveStrengthAmulet',
  'giveDefenseAmulet',
  'giveCriticalHitAmulet',
  'giveSpeedAmulet',
  'upgradeTools',
  'postGraduates',
  'moveFlags',
];

/** The goods each give switch grants, by catalog slug, because the sandbox catalog and real content number
 *  the same goods differently. A potion switch grants both bottle sizes, the big one first: the sim hands
 *  out the big one while it lasts and treats either as the same drink. */
export const GIVE_SWITCH_GOODS: Readonly<Record<GiveSwitchId, readonly [string, ...string[]]>> = {
  giveBoots: ['shoes'],
  giveWoodenTools: ['tool_wooden'],
  giveIronTools: ['tool_iron'],
  giveMead: ['mead'],
  giveFoodPotions: ['potion_food_big', 'potion_food_small'],
  giveStaminaPotions: ['potion_stamina_big', 'potion_stamina_small'],
  giveHealingPotions: ['potion_heal_big', 'potion_heal_small'],
  giveFoodAmulet: ['amulet_food'],
  giveStaminaAmulet: ['amulet_stamina'],
  giveStrengthAmulet: ['amulet_strength'],
  giveDefenseAmulet: ['amulet_defense'],
  giveCriticalHitAmulet: ['amulet_crithit'],
  giveSpeedAmulet: ['amulet_speed'],
};
/** The give switches in {@link GRANT_IDS} order. */
export const GIVE_SWITCH_IDS: readonly GiveSwitchId[] = GRANT_IDS.filter(
  (id): id is GiveSwitchId => id in GIVE_SWITCH_GOODS,
);
/** The give switches that choose their audience as well: off, everyone, or soldiers alone. Gear has no
 *  audience, since tools already go only to the trades that work with them. */
export const AUDIENCE_SWITCH_IDS: readonly GiveSwitchId[] = [
  'giveMead',
  'giveFoodPotions',
  'giveStaminaPotions',
  'giveHealingPotions',
  'giveFoodAmulet',
  'giveStaminaAmulet',
  'giveStrengthAmulet',
  'giveDefenseAmulet',
  'giveCriticalHitAmulet',
  'giveSpeedAmulet',
];
