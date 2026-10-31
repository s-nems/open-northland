import { bcp47Tag } from '../../i18n/index.js';
import type { KnowledgeBase } from './base.js';
import { CAP_HITS, CRITICAL_CHANCE_PCT, HIT_DIRECTION, HUMAN_HITPOINTS } from './combat.js';

const PERCENT = 100;
const MAX_FRACTION_DIGITS = 2;

type FactReader = (base: KnowledgeBase) => number;

/** The numbers an article may name as `{{name}}`, so its text never retypes what the game owns. */
export const FACTS: Readonly<Record<string, FactReader>> = {
  humanHitpoints: () => HUMAN_HITPOINTS,
  fightExperienceCapHits: () => CAP_HITS,
  backSideHitMultiplier: () => HIT_DIRECTION.backSide / PERCENT,
  behindHitMultiplier: () => HIT_DIRECTION.behind / PERCENT,
  criticalChancePct: () => CRITICAL_CHANCE_PCT,
};

/** A number as the reader's language writes it. */
export function formatFactNumber(value: number, maxFraction = MAX_FRACTION_DIGITS, minFraction = 0): string {
  return new Intl.NumberFormat(bcp47Tag(), {
    minimumFractionDigits: minFraction,
    maximumFractionDigits: maxFraction,
    useGrouping: false,
  }).format(value);
}

export function factText(name: string, base: KnowledgeBase): string | undefined {
  const reader = Object.hasOwn(FACTS, name) ? FACTS[name] : undefined;
  return reader === undefined ? undefined : formatFactNumber(reader(base));
}
