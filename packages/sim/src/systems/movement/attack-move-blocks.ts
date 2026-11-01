import {
  combatEnemyMask,
  Owner,
  Palisade,
  PalisadeBlocking,
  PlayerOrder,
  Position,
} from '../../components/index.js';
import { JournaledCaptures } from '../../ecs/journaled-captures.js';
import type { Entity, World } from '../../ecs/world.js';
import type { BlockOverlay, NodeMask } from '../../nav/block-overlay.js';
import { nodeOfPosition } from '../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../nav/terrain/index.js';
import type { ContentContext } from '../context.js';
import { translatedCells } from '../footprint/geometry.js';
import { walkBlockMask } from '../footprint/walk-block-mask.js';

interface Gate {
  readonly owner: number;
  readonly cells: readonly NodeId[];
}

export interface AttackMoveBlocks {
  readonly blocked: BlockOverlay;
  /** Virtual gate bodies, so a refused march can identify the gate it must break. */
  readonly gates: ReadonlyMap<NodeId, Entity>;
}

function captureGate(world: World, terrain: TerrainGraph, e: Entity): Gate | null {
  const wall = world.tryGet(e, Palisade);
  const owner = world.tryGet(e, Owner)?.player;
  const p = world.tryGet(e, Position);
  if (!world.has(e, PalisadeBlocking) || wall?.gate?.open !== true || owner === undefined || p === undefined)
    return null;
  const { hx, hy } = nodeOfPosition(p.x, p.y);
  return { owner, cells: translatedCells(terrain, wall.placementWalk, hx, hy) };
}

/** The levelled walk-block mask plus the enemy gate cells, each one byte per node, so a test is two array
 *  reads. */
class GatedBlocks implements BlockOverlay {
  constructor(
    private readonly actual: NodeMask,
    private readonly gateCells: EnemyGateCells,
  ) {}
  has(node: NodeId): boolean {
    return this.actual.blocked[node] === 1 || this.gateCells.bytes[node] === 1;
  }
  get size(): number {
    return this.actual.size + this.gateCells.count;
  }
}

/** The cells of the gates one enemy set must break, one byte per node, 1 on a gate cell. */
interface EnemyGateCells {
  readonly bytes: Uint8Array;
  readonly count: number;
}

class GatePlans {
  private readonly gates = new Map<Entity, Gate>();
  /** Per enemy mask; gates alone shape them, so only a gate change drops them. */
  private readonly gateCells = new Map<number, EnemyGateCells>();
  private readonly captures: JournaledCaptures<Gate>;
  private readonly plans = new Map<number, AttackMoveBlocks>();
  private blockVersion = -1;

  constructor(
    private readonly world: World,
    readonly terrain: TerrainGraph,
  ) {
    this.captures = new JournaledCaptures(
      world,
      // Walls never move, and their shape/state changes replace Palisade.
      {
        membership: [Palisade, PalisadeBlocking, Owner, Position],
        values: [Owner],
      },
      () => world.query(PalisadeBlocking, Palisade, Owner, Position),
      {
        capture: (e) => captureGate(world, terrain, e),
        apply: (e, gate) => {
          this.gates.set(e, gate);
          this.plans.clear();
          this.gateCells.clear();
        },
        withdraw: (e) => {
          this.gates.delete(e);
          this.plans.clear();
          this.gateCells.clear();
        },
        clear: () => {
          this.gates.clear();
          this.plans.clear();
          this.gateCells.clear();
        },
      },
    );
  }

  forPlayer(ctx: ContentContext, player: number): AttackMoveBlocks {
    this.captures.catchUp();
    const mask = walkBlockMask(this.world, ctx, this.terrain);
    const actual = mask.levelled();
    if (this.blockVersion !== mask.version) {
      this.plans.clear();
      this.blockVersion = mask.version;
    }
    const enemies = combatEnemyMask(this.world, player);
    let plan = this.plans.get(enemies);
    if (plan !== undefined) return plan;
    const gates = new Map<NodeId, Entity>();
    for (const [e, gate] of this.gates) {
      if ((enemies & (1 << gate.owner)) === 0) continue;
      for (const node of gate.cells) {
        const prior = gates.get(node);
        if (prior === undefined || e < prior) gates.set(node, e);
      }
    }
    plan = {
      blocked: gates.size === 0 ? actual : new GatedBlocks(actual, this.cellsOf(enemies, gates)),
      gates,
    };
    this.plans.set(enemies, plan);
    return plan;
  }

  private cellsOf(enemies: number, gates: ReadonlyMap<NodeId, Entity>): EnemyGateCells {
    let cells = this.gateCells.get(enemies);
    if (cells === undefined) {
      const bytes = new Uint8Array(this.terrain.nodeCount);
      for (const node of gates.keys()) bytes[node] = 1;
      cells = { bytes, count: gates.size };
      this.gateCells.set(enemies, cells);
    }
    return cells;
  }

  verify(): string[] {
    this.captures.catchUp();
    const fresh = new Map<Entity, Gate>();
    for (const e of this.world.query(PalisadeBlocking, Palisade, Owner, Position)) {
      const gate = captureGate(this.world, this.terrain, e);
      if (gate !== null) fresh.set(e, gate);
    }
    if (
      fresh.size === this.gates.size &&
      [...fresh].every(([e, gate]) => {
        const held = this.gates.get(e);
        return (
          held?.owner === gate.owner &&
          held.cells.length === gate.cells.length &&
          held.cells.every((node, i) => node === gate.cells[i])
        );
      })
    )
      return [];
    return ['attackMoveBlocks holds stale gate bodies or owners'];
  }
}

const plans = new WeakMap<World, GatePlans>();

/** Project rule: an attack-move plans for enemy gates closing before it arrives. This never changes
 * the physical gate, friendly passage, or an ordinary move order. All attackers share each topology. */
export function attackMoveBlocks(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  player: number,
): AttackMoveBlocks {
  let held = plans.get(world);
  if (held?.terrain !== terrain) {
    held = new GatePlans(world, terrain);
    plans.set(world, held);
    const index = held;
    world.registerCacheVerifier('attackMoveBlocks', () => index.verify());
  }
  return held.forPlayer(ctx, player);
}

export function routeStructureBlocks(
  world: World,
  ctx: ContentContext,
  terrain: TerrainGraph,
  e?: Entity,
): BlockOverlay {
  const player = e === undefined ? undefined : world.tryGet(e, Owner)?.player;
  if (e !== undefined && player !== undefined && world.tryGet(e, PlayerOrder)?.attackMove !== undefined)
    return attackMoveBlocks(world, ctx, terrain, player).blocked;
  return walkBlockMask(world, ctx, terrain).levelled();
}
