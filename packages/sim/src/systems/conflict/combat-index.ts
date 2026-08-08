import type { ContentSet } from '@open-northland/data';
import { Anger, Owner, Settler } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { SystemContext } from '../context.js';
import { isAggressiveAnimal, isAnimalTribe } from '../readviews/index.js';
import { entityNode, NodeBuckets } from '../spatial/nodes.js';
import { buildingBodyNodes } from './target-node.js';

/** Coarse cell edge (half-cell nodes). Sized so a sight- or defend-radius query (≤ ~20 nodes) spans at most
 *  two cells per axis; only query cost depends on it, never a winner. */
const COARSE_CELL_NODES = 32;

/** An unowned animal's presence class, or null for anything owned or non-animal. */
type WildClass = 'passive' | 'hostile' | null;

/** One coarse cell: its early-out tallies, and the (target, node) pairs whose fine buckets are still
 *  unbuilt. Counts are per member, not per node - both queries reduce to "does a member of some class
 *  exist here?", which no weighting can change. */
interface CoarseCell {
  total: number;
  passive: number;
  hostileAnimal: number;
  readonly byPlayer: Map<number, number>;
  readonly members: Entity[];
  readonly memberNodes: NodeId[];
  /** The last member tallied, so a building's several nodes in one cell count once. */
  countedLast: Entity | null;
  realized: boolean;
}

/**
 * The combat tick's target index over every combatant and attackable building: a coarse count grid gating
 * the fine ring-search buckets under it. Derived state, rebuilt each tick and never hashed.
 *
 * The coarse queries over-approximate (Chebyshev box ⊇ Manhattan diamond, cell granularity, and "not mine
 * minus passive wildlife" ⊇ every gated accept filter), so a `false` proves the ring search would find
 * nothing; a seeker whose filter breaks that superset is ungated via a null `EngageSpec.player`.
 *
 * A coarse cell's fine buckets are built on the first query that reaches it, which is what keeps the build
 * proportional to active conflict rather than to map population. Every query realizes the whole box it is
 * about to walk first, so the walk reads exactly what an up-front build would have put there.
 */
export class CombatIndex {
  /** Coarse column → row → cell; nested numeric maps keep negative/off-map nodes collision-free. */
  private readonly byCx = new Map<number, Map<number, CoarseCell>>();
  private readonly fine: NodeBuckets;
  private readonly content: ContentSet;
  private readonly tick: number;

  /** `combatants` are the seekers and unit targets, `buildings` the live attackable structures; a building
   *  joins at every wall node, so a ring search finds it at the distance to its nearest face. */
  constructor(
    private readonly world: World,
    ctx: SystemContext,
    private readonly terrain: TerrainGraph,
    combatants: Iterable<Entity>,
    buildings: Iterable<Entity>,
  ) {
    this.content = ctx.content;
    this.tick = ctx.tick;
    this.fine = new NodeBuckets(world, []);
    for (const e of combatants) this.admit(e, entityNode(world, terrain, e));
    for (const b of buildings) {
      for (const node of buildingBodyNodes(world, ctx, terrain, b)) this.admit(b, node);
    }
  }

  /** The nearest indexed target to node (fromX, fromY) satisfying `accept`, over `minDist..maxDist`.
   *  `accept` may re-enter this method: the box is realized before the walk starts, so a nested query can
   *  only realize cells holding no node this walk reads. */
  nearest(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
  ): { entity: Entity; distance: number } | null {
    this.realizeBox(fromX, fromY, maxDist);
    return this.fine.nearest(fromX, fromY, minDist, maxDist, accept);
  }

  nearestFew(
    fromX: number,
    fromY: number,
    minDist: number,
    maxDist: number,
    accept: (e: Entity) => boolean,
    limit: number,
  ): readonly { entity: Entity; distance: number }[] {
    this.realizeBox(fromX, fromY, maxDist);
    return this.fine.nearestFew(fromX, fromY, minDist, maxDist, accept, limit);
  }

  /**
   * Whether any combatant not owned by `player` might lie within Manhattan `radius` of node (hx, hy).
   * `false` is a proof of absence; `true` only means "run the real search".
   */
  othersWithin(player: number, hx: number, hy: number, radius: number): boolean {
    return this.someCell(
      hx,
      hy,
      radius,
      (cell) => cell.total - cell.passive > (cell.byPlayer.get(player) ?? 0),
    );
  }

  /**
   * Whether any civilization combatant - everything not classified wildlife - might lie within Manhattan
   * `radius` of node (hx, hy). The hostile-animal seeker's early-out twin of {@link othersWithin}, since a
   * wild animal's only valid targets are civilization settlers.
   */
  civsWithin(hx: number, hy: number, radius: number): boolean {
    return this.someCell(hx, hy, radius, (cell) => cell.total - cell.passive - cell.hostileAnimal > 0);
  }

  /** Tally `e` into node `node`'s coarse cell and hold the pair for that cell's eventual fine build. */
  private admit(e: Entity, node: NodeId): void {
    const cell = this.cellAt(coarseOf(this.terrain.xOf(node)), coarseOf(this.terrain.yOf(node)));
    cell.members.push(e);
    cell.memberNodes.push(node);
    if (cell.countedLast === e) return;
    cell.countedLast = e;
    cell.total++;
    const wild = this.wildClassOf(e);
    if (wild === 'passive') cell.passive++;
    else if (wild === 'hostile') cell.hostileAnimal++;
    const owner = this.world.tryGet(e, Owner);
    if (owner !== undefined) cell.byPlayer.set(owner.player, (cell.byPlayer.get(owner.player) ?? 0) + 1);
  }

  /**
   * Classify an unowned animal member: `'passive'` is discounted from {@link othersWithin} and `'hostile'`
   * additionally from {@link civsWithin}, so neither a grazing herd nor a wolf pack can defeat every gated
   * seeker's early-out. Pure reads - the lapsed-Anger reap stays with the attacker pass, and it can only
   * grow the passive share within the tick, which leaves the build-time tally conservative.
   */
  private wildClassOf(e: Entity): WildClass {
    const { world, content } = this;
    if (world.has(e, Owner)) return null;
    const s = world.tryGet(e, Settler);
    if (s === undefined || !isAnimalTribe(content, s.tribe)) return null;
    if (isAggressiveAnimal(content, s.tribe)) return 'hostile';
    const anger = world.tryGet(e, Anger);
    return anger !== undefined && this.tick < anger.until ? 'hostile' : 'passive';
  }

  /** Build the fine buckets of every coarse cell overlapping the box `radius` nodes around (hx, hy). */
  private realizeBox(hx: number, hy: number, radius: number): void {
    const { cx0, cx1, cy0, cy1 } = boxCellRange(hx, hy, radius);
    for (let cx = cx0; cx <= cx1; cx++) {
      const column = this.byCx.get(cx);
      if (column === undefined) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = column.get(cy);
        if (cell !== undefined && !cell.realized) this.realize(cell);
      }
    }
  }

  private realize(cell: CoarseCell): void {
    cell.realized = true;
    for (let i = 0; i < cell.members.length; i++) {
      const e = cell.members[i];
      const node = cell.memberNodes[i];
      if (e === undefined || node === undefined) continue;
      // Sorted insert, not append: cells realize in query order, and only ascending-id buckets make a
      // ring search's first match the canonical winner.
      this.fine.insert(e, this.terrain.xOf(node), this.terrain.yOf(node));
    }
  }

  /** Whether any coarse cell overlapping the box `radius` nodes around (hx, hy) passes `test`. */
  private someCell(hx: number, hy: number, radius: number, test: (cell: CoarseCell) => boolean): boolean {
    const { cx0, cx1, cy0, cy1 } = boxCellRange(hx, hy, radius);
    for (let cx = cx0; cx <= cx1; cx++) {
      const column = this.byCx.get(cx);
      if (column === undefined) continue;
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = column.get(cy);
        if (cell !== undefined && test(cell)) return true;
      }
    }
    return false;
  }

  private cellAt(cx: number, cy: number): CoarseCell {
    let column = this.byCx.get(cx);
    if (column === undefined) {
      column = new Map<number, CoarseCell>();
      this.byCx.set(cx, column);
    }
    let cell = column.get(cy);
    if (cell === undefined) {
      cell = {
        total: 0,
        passive: 0,
        hostileAnimal: 0,
        byPlayer: new Map<number, number>(),
        members: [],
        memberNodes: [],
        countedLast: null,
        realized: false,
      };
      column.set(cy, cell);
    }
    return cell;
  }
}

function coarseOf(node: number): number {
  return Math.floor(node / COARSE_CELL_NODES);
}

/** The inclusive coarse-cell range covering the box `radius` nodes around (hx, hy). */
function boxCellRange(
  hx: number,
  hy: number,
  radius: number,
): { cx0: number; cx1: number; cy0: number; cy1: number } {
  return {
    cx0: coarseOf(hx - radius),
    cx1: coarseOf(hx + radius),
    cy0: coarseOf(hy - radius),
    cy1: coarseOf(hy + radius),
  };
}
