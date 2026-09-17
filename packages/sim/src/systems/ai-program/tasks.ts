import type { MapAiTask } from '@open-northland/data';
import {
  type AiConditionRecord,
  type AiTaskRecord,
  type DiplomacyState,
  isValidPlayer,
  setDiplomacyStance,
} from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { ownedSettlers } from '../ai-player/seat-roster.js';
import type { SystemContext } from '../context.js';
import { removeSettlerSilently } from '../lifecycle/cleanup.js';
import { spawnSettler } from '../spawn/index.js';
import { conditionActive } from './conditions.js';

// The main tasks of one seat's program: the readings of the the original's
// `an original routine` and `an original routine`
// (`docs/formats/MISSIONS.md`, AI data).

/** The `ChangeDiplomacy` state codes, as `SetDiplomacy` writes them. */
const DIPLOMACY_BY_CODE: Readonly<Record<number, DiplomacyState>> = { 1: 'friend', 2: 'neutral', 3: 'enemy' };

/** `SelfDestroyPlayer` carries no priority of its own; the loader gives it this one. */
const SELF_DESTROY_PRIORITY = 1;

/** How many Attack tasks on one point one group takes, and how many groups a seat runs. */
const GROUP_TASK_LIMIT = 10;
const GROUP_LIMIT = 50;

/** A soldier task: Defend and Attack, the two kinds the assignment hands soldiers to. */
export type SoldierTask = Extract<MapAiTask, { kind: 'defend' | 'attack' }>;

export function freshTaskRecord(): AiTaskRecord {
  return { done: false, priority: 0 };
}

/**
 * Re-judge every task against its condition: a task whose condition holds and that has not run out
 * takes its priority, the rest read 0. A one-shot task whose priority is set runs here and is marked
 * done (`CreateCreatures` only when told to run once); the soldier tasks keep their priority for the
 * assignment.
 */
export function recheckTasks(
  world: World,
  ctx: SystemContext,
  seat: number,
  defs: readonly MapAiTask[],
  records: AiTaskRecord[],
  conditions: readonly (AiConditionRecord | null)[],
): void {
  defs.forEach((def, i) => {
    const record = records[i];
    if (record === undefined) return;
    if (record.done || !conditionActive(conditions, def.condition)) {
      record.priority = 0;
      return;
    }
    record.priority = priorityOf(def);
    if (record.priority === 0 || def.kind === 'defend' || def.kind === 'attack') return;
    record.done = runOnce(world, ctx, seat, def);
    record.priority = 0;
  });
}

function priorityOf(def: MapAiTask): number {
  return def.kind === 'selfDestroyPlayer' ? SELF_DESTROY_PRIORITY : def.priority;
}

/** Run a one-shot task through the seams a mission result uses, and say whether it is spent. */
function runOnce(
  world: World,
  ctx: SystemContext,
  seat: number,
  def: Exclude<MapAiTask, SoldierTask>,
): boolean {
  switch (def.kind) {
    case 'createCreatures':
      for (let i = 0; i < def.count; i++) {
        spawnSettler(world, ctx, {
          kind: 'spawnSettler',
          jobType: def.job,
          tribe: def.tribe,
          x: def.x,
          y: def.y,
          owner: seat,
          ...(def.missionId !== 0 ? { missionId: def.missionId } : {}),
        });
      }
      return def.once;
    case 'changeDiplomacy': {
      const state = DIPLOMACY_BY_CODE[def.state];
      if (state !== undefined && isValidPlayer(def.player))
        setDiplomacyStance(world, seat, def.player, state);
      return true;
    }
    case 'selfDestroyPlayer':
      // A snapshot, since removal destroys what the roster walks; a script removal is not a death.
      for (const e of [...ownedSettlers(world, seat)]) removeSettlerSilently(world, e);
      return true;
  }
}

/** The active soldier tasks combined for the assignment: Attack tasks on one point fold into a group
 *  that pools their priority and soldier bounds and averages their rally points; a Defend task is a
 *  group of its own. Sorted by pooled priority, highest first. */
export interface TaskGroup {
  readonly kind: SoldierTask['kind'];
  /** The script indices of the tasks, the first naming the group. */
  readonly tasks: readonly number[];
  readonly priority: number;
  readonly hx: number;
  readonly hy: number;
  /** The widest range among the tasks. */
  readonly range: number;
  readonly min: number;
  /** The pooled cap, 0 for none. */
  readonly max: number;
  readonly rally: { hx: number; hy: number } | null;
}

export function activeGroups(defs: readonly MapAiTask[], records: readonly AiTaskRecord[]): TaskGroup[] {
  const active: Array<{ index: number; priority: number; def: SoldierTask }> = [];
  defs.forEach((def, index) => {
    const priority = records[index]?.priority ?? 0;
    if (priority !== 0 && (def.kind === 'defend' || def.kind === 'attack'))
      active.push({ index, priority, def });
  });
  // Highest priority first; the sort is stable, so equal priorities keep script order.
  active.sort((a, b) => b.priority - a.priority);

  const groups: Array<{
    kind: SoldierTask['kind'];
    tasks: number[];
    priority: number;
    hx: number;
    hy: number;
    range: number;
    min: number;
    max: number;
    rally: { hx: number; hy: number } | null;
  }> = [];
  for (const { index, priority, def } of active) {
    const joined =
      def.kind === 'attack'
        ? groups.find(
            (g) =>
              g.kind === 'attack' && g.hx === def.x && g.hy === def.y && g.tasks.length < GROUP_TASK_LIMIT,
          )
        : undefined;
    if (joined !== undefined && joined.rally !== null && def.kind === 'attack') {
      joined.tasks.push(index);
      joined.priority += priority;
      joined.min += def.min;
      joined.max += def.max;
      joined.range = Math.max(joined.range, def.range);
      joined.rally = {
        hx: Math.trunc((joined.rally.hx + def.rallyX) / 2),
        hy: Math.trunc((joined.rally.hy + def.rallyY) / 2),
      };
      continue;
    }
    if (groups.length === GROUP_LIMIT) break;
    groups.push({
      kind: def.kind,
      tasks: [index],
      priority,
      hx: def.x,
      hy: def.y,
      range: def.range,
      min: def.min,
      max: def.max,
      rally: def.kind === 'attack' ? { hx: def.rallyX, hy: def.rallyY } : null,
    });
  }
  groups.sort((a, b) => b.priority - a.priority);
  return groups;
}
