import type { KnowledgeBase } from '../model.js';
import { AIM_FACTS, COMBAT_FACTS, FIGHT_FACTS, WALL_FACTS, WEAPON_FACTS } from './combat.js';
import { HEALTH_FACTS, LIFE_FACTS, NEED_FACTS } from './life.js';
import { durationText, type Fact, formatFactNumber } from './reader.js';
import { BUILD_TABLE_FACTS, CART_LOAD_FACTS, TOOL_FACTS, WALK_FACTS, WORK_FACTS } from './work.js';
import { WORLD_FACTS } from './world.js';

/** The numbers an article may name as `{{name}}`, so its text never retypes what the game owns. */
export const FACTS: Readonly<Record<string, Fact>> = {
  ...NEED_FACTS,
  ...HEALTH_FACTS,
  ...LIFE_FACTS,
  ...WALK_FACTS,
  ...WORK_FACTS,
  ...COMBAT_FACTS,
  ...AIM_FACTS,
  ...WALL_FACTS,
  ...WORLD_FACTS,
  ...WEAPON_FACTS,
  ...BUILD_TABLE_FACTS,
  ...TOOL_FACTS,
  ...CART_LOAD_FACTS,
  ...FIGHT_FACTS,
};

export function factText(name: string, base: KnowledgeBase): string | undefined {
  const fact = Object.hasOwn(FACTS, name) ? FACTS[name] : undefined;
  const value = fact?.read(base);
  if (fact === undefined || value === undefined) return undefined;
  return fact.duration === true
    ? durationText(value)
    : formatFactNumber(value, fact.maxFraction, fact.minFraction);
}
