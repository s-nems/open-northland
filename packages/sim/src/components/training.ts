import { defineComponent, type Entity } from '../ecs/world.js';

/**
 * A settler's live training order: the barracks drill or, with a `lesson`, the school course it was sent
 * to, and the ticks it still owes. A started repetition always plays out, so a drill overshoots
 * `drillTicksLeft` by less than one exercise clip. It survives a needs detour; a move order, a player
 * equip order, a profession change, or a script fixing the trade calls it off.
 *
 * A house trains at most its `schoolSize` settlers at once. A free seat goes to the earliest `enrolled`
 * tick, then the lowest id; the others wait in the yard. A seat is kept until the order ends.
 */
export const TrainingOrder = defineComponent<{
  house: Entity;
  drillTicksLeft: number;
  lesson?: { kind: 'job' | 'good'; typeId: number };
  enrolled: number;
  seated: boolean;
}>('TrainingOrder', 'settlers');

/**
 * A school graduate that left without a workplace: whenever its ladder finds nothing to do, it walks back
 * and waits in the school's yard, where the player looks for the settlers just trained there. Needs and
 * errands still take it away. A trade change, a workplace, a move order or a new course ends the wait, as
 * does the school's loss. Owner's ruling after the original, where graduates gather beside their school.
 */
export const GraduateWait = defineComponent<{ school: Entity }>('GraduateWait', 'settlers');

/**
 * The flag a barracks sends the soldiers it trains to: a {@link DeliveryFlag} marker the owner planted, the
 * same flag a gatherer's work area uses. A recruit that finishes its drill takes the flag's node as its
 * guard anchor, so it walks there from the door and holds it. Soldiers already trained keep their own
 * anchors. The flag is minted and moved by the owner's order and destroyed with the barracks; our own
 * rule, not the original's. Absent while the barracks keeps no rally point, and its recruits then stay
 * where they step out.
 */
export const RallyPoint = defineComponent<{ flag: Entity }>('RallyPoint', 'settlers');
