import { missionRecords } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { MissionScript } from './script.js';

/** One mission as the mission window lists it: the goal text's string id when the author gave one,
 *  and the flags the window's markers read. */
export interface MissionStatus {
  readonly index: number;
  readonly description: number | undefined;
  readonly visible: boolean;
  readonly active: boolean;
  /** Whether the last check satisfied the mission's rule, which is the window's "done" mark. */
  readonly done: boolean;
}

/** Every mission of the script with its live flags, in script order; a mission the system has not
 *  initialised yet reads its authored flags. */
export function missionStatus(world: World, script: MissionScript | undefined): MissionStatus[] {
  if (script === undefined) return [];
  const records = missionRecords(world);
  return script.missions.map((definition, index) => {
    const record = records[index];
    return {
      index,
      description: definition.description,
      visible: record?.visible ?? definition.visible,
      active: record?.active ?? definition.active,
      done: record?.evaluated ?? false,
    };
  });
}
