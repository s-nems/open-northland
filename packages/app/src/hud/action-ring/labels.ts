import type { UiString } from '../../content/gui-gfx.js';
import { currentLocale, type Locale, messages } from '../../i18n/index.js';
import type { ActionCommandId } from './commands.js';

/** String ids in the mod's `ingameguimisclogic` table; text stays in generated content. */
const ACTION_STRING_IDS: Readonly<Record<ActionCommandId, number>> = {
  haveGirl: 16,
  haveBoy: 15,
  marry: 14,
  goTo: 1,
  changeProfession: 19,
  assignWorkArea: 33,
  erectSignpost: 36,
  assignBuildingSite: 27,
  assignLearningPlace: 25,
  removeWorkPlace: 24,
  assignWorkPlace: 23,
  removeHome: 18,
  assignHome: 17,
  attackInhabitants: 44,
  attackBuilding: 45,
  attackPosition: 48,
  attackMode: 38,
  defenceMode: 39,
  ignorantMode: 40,
  eat: 4,
  sleep: 6,
  talk: 8,
  pray: 10,
  changeEquipment: 21,
  showWorkArea: 34,
  explore: 37,
  removeBuildingSite: 28,
  removeLearningPlace: 26,
  assignVehicle: 31,
  removeVehicle: 32,
  attackAnimal: 46,
  attackVehicle: 47,
  allowRegeneration: 42,
  prohibitRegeneration: 43,
};

export function actionLabel(
  id: ActionCommandId,
  uiString: UiString,
  locale: Locale = currentLocale(),
): string {
  const fallback = messages(locale).actionRing[id];
  // These Polish rows mislabel signpost creation and misspell the defensive stance.
  if (locale === 'pol' && (id === 'erectSignpost' || id === 'defenceMode')) return fallback;
  return uiString('misclogic', ACTION_STRING_IDS[id], fallback);
}
