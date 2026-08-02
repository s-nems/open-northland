import { Owner } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { IndexNodeVisitor } from '../spatial/nodes.js';

/**
 * Coarse presence-cell edge (half-cell nodes). Sized so a sight/defend-radius query (≤ ~20 nodes)
 * touches at most a 3×3 cell block; only query cost depends on it, never a winner.
 */
const PRESENCE_CELL_NODES = 32;

/** Combatant counts on one coarse cell: everyone, the owned share per player, and the wildlife shares
 *  (see {@link HostilePresence}'s constructor `wildClassOf`). An unowned scenario civ counts only in
 *  `total`, so it always reads as "other" AND as a civilization. */
interface PresenceCell {
  total: number;
  passive: number;
  hostileAnimal: number;
  readonly byPlayer: Map<number, number>;
}

/**
 * A per-tick coarse count grid over the combatants - the CombatSystem's idle early-out (golden
 * rule 6): an owned seeker asks "could any combatant I don't own be within my search radius?" in
 * O(coarse cells) before paying the full ring search. Perf-only and conservative - the query
 * over-approximates (Chebyshev box ⊇ Manhattan diamond, coarse-cell granularity, and "not mine
 * minus passive wildlife" ⊇ every gated accept filter, because those all route hostility through
 * the owner-first `mayTarget` relation, whose neutral axis admits an unowned animal only when
 * hostile-now or as hunter prey), so a `false` proves the ring search would find nothing and
 * skipping it cannot change a winner. Seekers whose filter breaks that superset are ungated via a
 * null `EngageSpec.player` (or the flee drive's own hunter exemption): unowned ones (valid targets
 * can share the "unowned" class) and hunters (owner-blind prey filter admits passive huntable
 * animals). The passive share may only shrink within the tick (Anger is stamped by the earlier
 * atomic damage pass and only reaped here), so the build-time count stays conservative. Filled each
 * combat tick from the same walk as the ring-search index; derived state, never hashed.
 */
export class HostilePresence {
  /** Coarse column → row → counts; nested numeric maps keep negative/off-map nodes collision-free. */
  private readonly byCx = new Map<number, Map<number, PresenceCell>>();
  private readonly world: World;
  /**
   * Count `e` into node (x,y)'s coarse cell: the tally sink, public so the ring-search index's own build walk
   * can feed it (`NodeBuckets`'s `alsoVisit`). Owner and wildlife class are read per visit, so the one
   * reused visitor keeps no per-entity state.
   */
  readonly addNode: IndexNodeVisitor = (e, x, y) => {
    const cell = this.cellAt(Math.floor(x / PRESENCE_CELL_NODES), Math.floor(y / PRESENCE_CELL_NODES));
    cell.total++;
    const wild = this.wildClassOf?.(e) ?? null;
    if (wild === 'passive') cell.passive++;
    else if (wild === 'hostile') cell.hostileAnimal++;
    const owner = this.world.tryGet(e, Owner);
    if (owner !== undefined) cell.byPlayer.set(owner.player, (cell.byPlayer.get(owner.player) ?? 0) + 1);
  };

  private readonly wildClassOf: ((e: Entity) => 'passive' | 'hostile' | null) | undefined;

  constructor(
    world: World,
    /** Classifies an unowned animal combatant: `'passive'` (non-hostile-now - discounted from
     *  `othersWithin`, so a map of grazing herds cannot defeat every gated seeker's early-out) or
     *  `'hostile'` (aggressive/angry - additionally discounted from `civsWithin`, so a wolf pack
     *  cannot defeat its own members' early-out); `null` for everything else. */
    wildClassOf?: (e: Entity) => 'passive' | 'hostile' | null,
  ) {
    this.world = world;
    this.wildClassOf = wildClassOf;
  }

  /**
   * Whether any combatant not owned by `player` (another player's unit, or any unowned one) might
   * lie within Manhattan `radius` of node (hx, hy) - checked over the coarse cells intersecting the
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
        if (cell !== undefined && cell.total - cell.passive > (cell.byPlayer.get(player) ?? 0)) return true;
      }
    }
    return false;
  }

  /**
   * Whether any CIVILIZATION combatant (owned or unowned - everything that is not classified wildlife)
   * might lie within Manhattan `radius` of node (hx, hy) - the hostile-animal seeker's early-out twin of
   * {@link othersWithin} (a wild animal's only valid targets are civilization settlers). Same
   * conservative Chebyshev-box over-approximation; `false` proves the ring search would find nothing.
   */
  civsWithin(hx: number, hy: number, radius: number): boolean {
    const cx0 = Math.floor((hx - radius) / PRESENCE_CELL_NODES);
    const cx1 = Math.floor((hx + radius) / PRESENCE_CELL_NODES);
    const cy0 = Math.floor((hy - radius) / PRESENCE_CELL_NODES);
    const cy1 = Math.floor((hy + radius) / PRESENCE_CELL_NODES);
    for (let cx = cx0; cx <= cx1; cx++) {
      const column = this.byCx.get(cx);
      if (column === undefined) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = column.get(cy);
        if (cell !== undefined && cell.total - cell.passive - cell.hostileAnimal > 0) return true;
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
      cell = { total: 0, passive: 0, hostileAnimal: 0, byPlayer: new Map<number, number>() };
      column.set(cy, cell);
    }
    return cell;
  }
}
