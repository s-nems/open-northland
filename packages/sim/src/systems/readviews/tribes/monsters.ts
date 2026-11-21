import type { ContentSet, MonsterRules } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

/** The authored monster rules of `tribeType`, or `undefined` for a people, an animal or an unknown id. */
export function monsterRulesOf(content: ContentSet, tribeType: number): MonsterRules | undefined {
  return contentIndex(content).tribes.get(tribeType)?.monster;
}

/** Whether `tribeType` is a monster with a hide: blows on it land on a weapon's monster column. */
export function hasMonsterHide(content: ContentSet, tribeType: number): boolean {
  return monsterRulesOf(content, tribeType)?.hide === true;
}
