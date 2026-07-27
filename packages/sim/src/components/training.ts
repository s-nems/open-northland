import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A settler's live barracks-drill order: the training house it was sent to and the drill ticks it still
 * owes. Stamped by the `trainSoldier` order handler; the planner's training rung
 * (`systems/settlers/drives/training.ts`) walks the settler to the door, keeps it inside for the drill and
 * enlists it on completion. A started repetition always plays out, so a drill overshoots
 * `drillTicksLeft` by less than one exercise clip.
 *
 * Held through a needs detour, so a recruit that breaks off to eat comes back and drills off what it
 * still owes. A move order, an equip errand and a profession change each call it off — the settler was
 * re-tasked.
 */
export const TrainingOrder = defineComponent<{
  house: Entity;
  drillTicksLeft: number;
}>('TrainingOrder');
