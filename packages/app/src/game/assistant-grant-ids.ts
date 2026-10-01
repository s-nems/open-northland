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
