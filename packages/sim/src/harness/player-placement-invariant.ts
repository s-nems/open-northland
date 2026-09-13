import { isValidPlayer, PlayerPlacementRules, validPlacementTribes } from '../components/index.js';
import { isPlainRecord } from '../core/plain-value.js';
import type { Invariant } from './invariants.js';

export const playerPlacementRulesValid: Invariant = (world, content) => {
  const errors: string[] = [];
  let carriers = 0;
  for (const entity of world.query(PlayerPlacementRules)) {
    carriers++;
    const value: unknown = world.get(entity, PlayerPlacementRules);
    if (!isPlainRecord(value) || !(value.tribes instanceof Map)) {
      errors.push(`entity ${entity}: invalid PlayerPlacementRules map`);
      continue;
    }
    for (const [player, tribes] of value.tribes as Map<unknown, unknown>) {
      if (typeof player !== 'number' || !isValidPlayer(player)) {
        errors.push(`entity ${entity}: invalid PlayerPlacementRules seat`);
      }
      if (!validPlacementTribes(content, tribes) || new Set(tribes).size !== tribes.length) {
        errors.push(`entity ${entity}: invalid PlayerPlacementRules tribes`);
      }
    }
  }
  if (carriers > 1) errors.push('multiple PlayerPlacementRules carriers');
  return errors;
};
