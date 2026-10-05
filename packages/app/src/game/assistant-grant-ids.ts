/** The assistant's switch rows: four "give everyone …" grants, three that let recruits be armed with a
 *  class's weaker weapon, one that sends school graduates straight to a free workplace, and one that lets
 *  gatherers move their flags after the resources. */
export type AssistantGrantId =
  | 'giveBoots'
  | 'giveWoodenTools'
  | 'giveIronTools'
  | 'giveMead'
  | 'allowShortSwords'
  | 'allowWoodenSpears'
  | 'allowShortBows'
  | 'postGraduates'
  | 'moveFlags';

export const GRANT_IDS: readonly AssistantGrantId[] = [
  'giveBoots',
  'giveWoodenTools',
  'giveIronTools',
  'giveMead',
  'allowShortSwords',
  'allowWoodenSpears',
  'allowShortBows',
  'postGraduates',
  'moveFlags',
];

export type GiveSwitchId = Extract<AssistantGrantId, `give${string}`>;
export type WeaponSwitchId = Extract<AssistantGrantId, `allow${string}`>;

/** The good each switch flips, by catalog slug, because the sandbox catalog and real content number the
 *  same goods differently. A give switch grants its good, a weapon switch lifts its recruit-arming veto. */
export const GIVE_SWITCH_GOOD: Readonly<Record<GiveSwitchId, string>> = {
  giveBoots: 'shoes',
  giveWoodenTools: 'tool_wooden',
  giveIronTools: 'tool_iron',
  giveMead: 'mead',
};
export const WEAPON_SWITCH_GOOD: Readonly<Record<WeaponSwitchId, string>> = {
  allowShortSwords: 'sword_shord',
  allowWoodenSpears: 'spear_wooden',
  allowShortBows: 'bow_short',
};
