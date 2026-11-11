import { defineComponent } from '../../ecs/world.js';

/**
 * A finished temple's holy fire, kept by the temple aura system once a game second. Owner ruling, not
 * the original's: a temple whose store holds fuel burns its oldest unit for a fixed time and blesses only
 * while a unit burns and it stands unwounded.
 */
export const TempleFire = defineComponent<{
  /** Game seconds the oldest stored unit of fuel has burned; it leaves the store when it burns out. */
  burnedSeconds: number;
  /** Whether the temple blesses the people around it, so its fire and glow show. */
  blessing: boolean;
}>('TempleFire', 'economy');
