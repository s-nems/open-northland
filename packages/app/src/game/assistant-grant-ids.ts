/** The assistant's switch rows: four "give everyone …" grants, then three that let recruits be armed with
 *  a class's weaker weapon. */
export type AssistantGrantId =
  | 'giveBoots'
  | 'giveWoodenTools'
  | 'giveIronTools'
  | 'giveMead'
  | 'allowShortSwords'
  | 'allowWoodenSpears'
  | 'allowShortBows';

export const GRANT_IDS: readonly AssistantGrantId[] = [
  'giveBoots',
  'giveWoodenTools',
  'giveIronTools',
  'giveMead',
  'allowShortSwords',
  'allowWoodenSpears',
  'allowShortBows',
];
