import { DEFAULT_HOUSEHOLD_GOOD_POLICY } from '../components/family.js';
import { isPlainRecord } from '../core/plain-value.js';
import type { WorldSnapshot } from './snapshot.js';
import { entitiesWith } from './snapshot-indexes.js';

export interface HouseholdGoodPolicyView {
  readonly cooking: boolean;
  readonly rest: boolean;
  readonly piety: boolean;
}

/** Decode one player's settlement-wide household-good policy: the lowest-id well-formed policy of
 *  `player` decides, and an absent one is the default. */
export function householdGoodPolicyView(snapshot: WorldSnapshot, player: number): HouseholdGoodPolicyView {
  for (const entity of entitiesWith(snapshot, 'HouseholdGoodPolicy')) {
    const raw = entity.components.HouseholdGoodPolicy;
    if (!isPlainRecord(raw) || raw.player !== player) continue;
    const { cooking, rest, piety } = raw;
    if (typeof cooking !== 'boolean' || typeof rest !== 'boolean' || typeof piety !== 'boolean') continue;
    return { cooking, rest, piety };
  }
  return DEFAULT_HOUSEHOLD_GOOD_POLICY;
}
