import type { ContentSet, MonsterRules } from '@open-northland/data';
import { contentIndex } from '../../../core/content-index.js';

/** The authored monster rules of `tribeType`, or `undefined` for a people, an animal or an unknown id. */
export function monsterRulesOf(content: ContentSet, tribeType: number): MonsterRules | undefined {
  return contentIndex(content).tribes.get(tribeType)?.monster;
}

/** Whether `tribeType` is a monster tribe: its blows land on a weapon's monster column. */
export function isMonsterTribe(content: ContentSet, tribeType: number): boolean {
  return monsterRulesOf(content, tribeType) !== undefined;
}
