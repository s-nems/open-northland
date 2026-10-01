import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A settler's live training order: the barracks drill or, with a `lesson`, the school course it was sent
 * to, and the ticks it still owes. A started repetition always plays out, so a drill overshoots
 * `drillTicksLeft` by less than one exercise clip. It survives a needs detour; a move order, a player
 * equip order, a profession change, or a script fixing the trade calls it off.
 */
export const TrainingOrder = defineComponent<{
  house: Entity;
  drillTicksLeft: number;
  lesson?: { kind: 'job' | 'good'; typeId: number };
}>('TrainingOrder', 'settlers');

/**
 * A school graduate that left without a workplace: whenever its ladder finds nothing to do, it walks back
 * and waits in the school's yard, where the player looks for the settlers just trained there. Needs and
 * errands still take it away. A trade change, a workplace, a move order or a new course ends the wait, as
 * does the school's loss. Owner's ruling after the original, where graduates gather beside their school.
 */
export const GraduateWait = defineComponent<{ school: Entity }>('GraduateWait', 'settlers');
