import { Owner, Position } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import { nodeOfPosition } from '../../nav/halfcell.js';

/**
 * Coarse presence-cell edge (half-cell nodes). Sized so a sight/defend-radius query (≤ ~20 nodes)
 * touches at most a 3×3 cell block; only query cost depends on it, never a winner.
 */
const PRESENCE_CELL_NODES = 32;

/** Combatant counts on one coarse cell: everyone, plus the owned share per player. Unowned
 *  combatants (wildlife, scenario civs) count only in `total`, so they always read as "other". */
interface PresenceCell {
  total: number;
  readonly byPlayer: Map<number, number>;
}

/**
 * A per-tick coarse count grid over the combatants — the CombatSystem's idle early-out (golden
 * rule 6): an owned seeker asks "could ANY combatant I don't own be within my search radius?" in
 * O(coarse cells) before paying the full ring search. Perf-only and conservative — the query
 * over-approximates (Chebyshev box ⊇ Manhattan diamond, coarse-cell granularity, and
 * "not mine" ⊇ every accept filter's hostility relation), so a `false` proves the ring search
 * would find nothing and skipping it cannot change a winner. Unowned seekers never consult it
 * (their valid targets can share their own "unowned" class). Rebuilt each combat tick from the
 * same combatant list as the ring-search index; derived state, never hashed.
 */
export class HostilePresence {
  /** Coarse column → row → counts; nested numeric maps keep negative/off-map nodes collision-free. */
  private readonly byCx = new Map<number, Map<number, PresenceCell>>();

  constructor(world: World, combatants: Iterable<Entity>) {
    for (const e of combatants) {
      const p = world.tryGet(e, Position);
      if (p === undefined) continue;
      // Bucket by the same raw (unclamped) node as NodeBuckets, so the superset claim holds per entity.
      const n = nodeOfPosition(p.x, p.y);
      const cell = this.cellAt(
        Math.floor(n.hx / PRESENCE_CELL_NODES),
        Math.floor(n.hy / PRESENCE_CELL_NODES),
      );
      cell.total++;
      const owner = world.tryGet(e, Owner);
      if (owner !== undefined) cell.byPlayer.set(owner.player, (cell.byPlayer.get(owner.player) ?? 0) + 1);
    }
  }

  /**
   * Whether any combatant not owned by `player` (another player's unit, or any unowned one) might
   * lie within Manhattan `radius` of node (hx, hy) — checked over the coarse cells intersecting the
   * covering Chebyshev box. `false` is a proof of absence; `true` only means "run the real search".
   */
  othersWithin(player: number, hx: number, hy: number, radius: number): boolean {
    const cx0 = Math.floor((hx - radius) / PRESENCE_CELL_NODES);
    const cx1 = Math.floor((hx + radius) / PRESENCE_CELL_NODES);
    const cy0 = Math.floor((hy - radius) / PRESENCE_CELL_NODES);
    const cy1 = Math.floor((hy + radius) / PRESENCE_CELL_NODES);
    for (let cx = cx0; cx <= cx1; cx++) {
      const column = this.byCx.get(cx);
      if (column === undefined) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = column.get(cy);
        if (cell !== undefined && cell.total > (cell.byPlayer.get(player) ?? 0)) return true;
      }
    }
    return false;
  }

  private cellAt(cx: number, cy: number): PresenceCell {
    let column = this.byCx.get(cx);
    if (column === undefined) {
      column = new Map<number, PresenceCell>();
      this.byCx.set(cx, column);
    }
    let cell = column.get(cy);
    if (cell === undefined) {
      cell = { total: 0, byPlayer: new Map<number, number>() };
      column.set(cy, cell);
    }
    return cell;
  }
}
