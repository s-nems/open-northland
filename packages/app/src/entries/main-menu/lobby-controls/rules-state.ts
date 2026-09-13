import type { FogModeName } from '../../../game/fog.js';

export const RULE_FOG_MODES: readonly FogModeName[] = ['off', 'reveal', 'recon'];

export function ruleChoiceState<T>(choices: readonly T[], change: (value: T) => void) {
  let current: T | undefined;
  let disabled = true;
  return {
    update(value: T, frozen: boolean): void {
      current = value;
      disabled = frozen;
    },
    value: () => current,
    request(value: T): void {
      if (!disabled && choices.includes(value) && value !== current) change(value);
    },
  };
}
