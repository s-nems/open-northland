import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A settler's live barracks-drill order: the training house it was sent to and the drill ticks it still
 * owes. A started repetition always plays out, so a drill overshoots `drillTicksLeft` by less than one
 * exercise clip. It survives a needs detour; a move order, a player equip order, or a profession change
 * calls it off.
 */
export const TrainingOrder = defineComponent<{
  house: Entity;
  drillTicksLeft: number;
}>('TrainingOrder');
