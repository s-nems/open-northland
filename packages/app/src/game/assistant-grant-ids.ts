/** The assistant's switch rows: four "give everyone …" grants, three that let recruits be armed with a
 *  class's weaker weapon, and one that sends school graduates straight to a free workplace. */
export type AssistantGrantId =
  | 'giveBoots'
  | 'giveWoodenTools'
  | 'giveIronTools'
  | 'giveMead'
  | 'allowShortSwords'
  | 'allowWoodenSpears'
  | 'allowShortBows'
  | 'postGraduates';

export const GRANT_IDS: readonly AssistantGrantId[] = [
  'giveBoots',
  'giveWoodenTools',
  'giveIronTools',
  'giveMead',
  'allowShortSwords',
  'allowWoodenSpears',
  'allowShortBows',
  'postGraduates',
];
