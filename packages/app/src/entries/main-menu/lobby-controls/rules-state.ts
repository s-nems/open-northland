import type { FogModeName } from '../../../game/fog.js';

export const RULE_FOG_MODES: readonly FogModeName[] = ['off', 'reveal', 'recon'];

/** A choice is requested when it differs from the last one requested, so a change the room has not
 *  acknowledged yet can still be taken back. */
export function ruleChoiceState<T>(choices: readonly T[], change: (value: T) => void) {
  let current: T | undefined;
  let requested: T | undefined;
  let disabled = true;
  return {
    update(value: T, frozen: boolean): void {
      current = value;
      requested = value;
      disabled = frozen;
    },
    value: () => current,
    request(value: T): void {
      if (disabled || !choices.includes(value) || value === requested) return;
      requested = value;
      change(value);
    },
  };
}
