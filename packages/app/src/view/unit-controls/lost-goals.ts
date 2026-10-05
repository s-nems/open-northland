import type { LostGoalMarker } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { nodeOfId } from '../../game/node-id.js';
import { lostGoalOf, ownerPlayerOf } from '../../game/snapshot.js';
import { ownedByAnotherSeat } from '../../game/viewer-seat.js';

/** One breath of a refused goal's marker. Wall-clock, so the mark keeps breathing while paused. */
export const LOST_GOAL_PULSE_MS = 1800;

/** The refused goals' shared breathing phase at `nowMs`, 0..1 and wrapping. */
export function lostGoalPulse(nowMs: number): number {
  return (nowMs % LOST_GOAL_PULSE_MS) / LOST_GOAL_PULSE_MS;
}

/**
 * The refused goals of the selected lost settlers, one marker per goal node. The pass runs over the
 * selection, and an unchanged answer hands back the previous list, so a consumer may key a redraw on it.
 * A settler of a seat other than `seat` is left out by the same test the settler panel offers its jump
 * by, so an ownerless one counts as the viewer's; null marks every selected one.
 */
export type LostGoalsOf = (
  snapshot: WorldSnapshot,
  selection: ReadonlySet<number>,
  seat: number | null,
) => readonly LostGoalMarker[];

const NONE: readonly LostGoalMarker[] = [];

/** `nodeWidth` is the half-cell lattice's row length, two nodes per cell across. */
export function createLostGoals(nodeWidth: number): LostGoalsOf {
  let last: readonly LostGoalMarker[] = NONE;
  const nodes: number[] = [];
  const seen = new Set<number>();
  return (snapshot, selection, seat) => {
    nodes.length = 0;
    seen.clear();
    for (const id of selection) {
      const e = entityById(snapshot, id);
      if (e === undefined || ownedByAnotherSeat(ownerPlayerOf(e), seat)) continue;
      const goal = lostGoalOf(e);
      if (goal === undefined || seen.has(goal)) continue;
      seen.add(goal);
      nodes.push(goal);
    }
    if (nodes.length === last.length && nodes.every((node, i) => last[i]?.node === node)) return last;
    last = nodes.length === 0 ? NONE : nodes.map((node) => ({ node, ...nodeOfId(node, nodeWidth) }));
    return last;
  };
}
