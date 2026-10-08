import type { components } from '@open-northland/sim';

/** The assistant's switch rows: the "give everyone …" grants (gear, drinks and charms), three that let
 *  recruits be armed with a class's weaker weapon, one that sends school graduates straight to a free
 *  workplace, one that lets gatherers move their flags after the resources, and the two audience limits
 *  that keep the drinks or the charms for soldiers alone. */
export type AssistantGrantId =
  | GiveSwitchId
  | WeaponSwitchId
  | AudienceSwitchId
  | 'postGraduates'
  | 'moveFlags';

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
export type WeaponSwitchId = 'allowShortSwords' | 'allowWoodenSpears' | 'allowShortBows';
export type AudienceSwitchId = 'drinksForSoldiers' | 'charmsForSoldiers';

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
  'allowShortSwords',
  'allowWoodenSpears',
  'allowShortBows',
  'drinksForSoldiers',
  'charmsForSoldiers',
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
/** The good a weapon switch lifts the recruit-arming veto of. */
export const WEAPON_SWITCH_GOOD: Readonly<Record<WeaponSwitchId, string>> = {
  allowShortSwords: 'sword_shord',
  allowWoodenSpears: 'spear_wooden',
  allowShortBows: 'bow_short',
};
/** The sim grant kind each audience switch keeps for soldiers while on. */
export const AUDIENCE_SWITCH_KIND: Readonly<Record<AudienceSwitchId, components.AssistantAudienceKind>> = {
  drinksForSoldiers: 'drink',
  charmsForSoldiers: 'charm',
};

/** The give switches granted from the start of a playable map: the gear and the mead, as before the
 *  potions and amulets had switches; those start off, since a druid's or coiner's output is dear. */
export const DEFAULT_GIVE_SWITCHES: readonly GiveSwitchId[] = [
  'giveBoots',
  'giveWoodenTools',
  'giveIronTools',
  'giveMead',
];
