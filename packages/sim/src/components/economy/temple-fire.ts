import { defineComponent } from '../../ecs/world.js';

/**
 * A finished temple's holy fire, kept by the temple aura system once a game second. Owner ruling, not
 * the original's: a temple whose store holds fuel burns its oldest unit for a fixed time and blesses only
 * while a unit burns, it stands unwounded and its owner has not put the fire out.
 */
export const TempleFire = defineComponent<{
  /** Game seconds the oldest stored unit of fuel has burned; it leaves the store when it burns out. */
  burnedSeconds: number;
  /** Whether the temple blesses the people around it, so its fire and glow show. */
  blessing: boolean;
  /** Whether its owner put the fire out (`setTempleFire`): it burns no fuel and blesses no one. */
  doused: boolean;
}>('TempleFire', 'economy');
