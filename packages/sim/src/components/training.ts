import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A settler's live barracks-drill order: the training house it was sent to and the drill ticks it still
 * owes. A started repetition always plays out, so a drill overshoots `drillTicksLeft` by less than one
 * exercise clip. It is held through a needs detour, so a recruit that breaks off to eat comes back and
 * drills off the rest; a move order, an equip errand or a profession change calls it off.
 */
export const TrainingOrder = defineComponent<{
  house: Entity;
  drillTicksLeft: number;
}>('TrainingOrder');
