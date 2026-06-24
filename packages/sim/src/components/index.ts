import { defineComponent } from '../ecs/world.js';
import type { Fixed } from '../fixed.js';

/**
 * Example components for the Phase-2 vertical slice. Components are PLAIN DATA only.
 * Positions/velocities are fixed-point (see fixed.ts) — never floats.
 *
 * This set is intentionally small; grow it as systems land (see docs/ROADMAP.md).
 */

/** World position in fixed-point tile units. */
export const Position = defineComponent<{ x: Fixed; y: Fixed }>('Position');

/** Per-tick movement delta in fixed-point tile units. */
export const Velocity = defineComponent<{ x: Fixed; y: Fixed }>('Velocity');

/** A settler: an autonomous individual. Behaviour fields grow with the AI/Needs systems. */
export const Settler = defineComponent<{
  tribe: number;
  jobType: number | null;
  /** 0..ONE hunger level; rises over time, NeedsSystem drives eating. */
  hunger: Fixed;
}>('Settler');

/** A building instance placed in the world. */
export const Building = defineComponent<{
  buildingType: number;
  tribe: number;
  /** 0..ONE construction progress; 1 == complete. */
  built: Fixed;
}>('Building');

/** A goods store attached to a building: goodType -> amount. */
export const Stockpile = defineComponent<{ amounts: Map<number, number> }>('Stockpile');

/** A path the entity is following: a list of fixed-point waypoints + current index. */
export const PathFollow = defineComponent<{ waypoints: Array<{ x: Fixed; y: Fixed }>; index: number }>(
  'PathFollow',
);
