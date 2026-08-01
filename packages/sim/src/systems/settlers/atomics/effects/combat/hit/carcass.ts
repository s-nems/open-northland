import {
  Position,
  Resource,
  type ResourceLayer,
  ResourceLayers,
  Settler,
} from '../../../../../../components/index.js';
import { contentIndex } from '../../../../../../core/content-index.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../../../../../nav/halfcell.js';
import type { NodeId } from '../../../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../../../context.js';
import { sowNodeOccupied } from '../../../../../economy/fields.js';
import { dynamicBlockOverlay, stampResourceFootprintOrFallback } from '../../../../../footprint/index.js';
import { huntYieldsOf, isHunterJob } from '../../../../../readviews/index.js';

/**
 * The hunter's kill payoff - a **hunter**'s lethal blow on huntable prey leaves ONE carcass on the
 * ground (user rule: one body, one decal): a harvestable {@link Resource} node holding the head of the
 * body's yield table, the rest queued as {@link ResourceLayers} (which owns the alternating-cadaver
 * source basis). The hunter works it through the ordinary gatherer machinery - one unit per pluck,
 * carried off over several trips, the node reaped when the last layer drains - and each layer carries
 * its good's cadaver decal index (`Resource.gfxIndex`, opaque to the sim), so the decal flips between
 * stages as the hunter works down the body.
 *
 * Placement: where the prey fell, or its first free walkable neighbour, falling back to the kill node
 * when hemmed in. Carcasses are unowned - a kill on shared ground is shared game. No-ops unless the
 * attacker is a hunter and the target huntable prey; mapless worlds (fixture combat tests) spawn
 * nothing. Pure over content + entity state - no RNG, no wall-clock.
 */
export function spawnCarcasses(world: World, ctx: SystemContext, attacker: Entity, target: Entity): void {
  const hunter = world.tryGet(attacker, Settler);
  if (hunter === undefined || !isHunterJob(ctx.content, hunter.jobType)) return; // hunters only
  const prey = world.tryGet(target, Settler);
  if (prey === undefined) return;
  const yields = huntYieldsOf(ctx.content, prey.tribe);
  if (yields === null) return; // not huntable prey - no carcass
  const terrain = ctx.terrain;
  const at = world.tryGet(target, Position);
  if (terrain === undefined || at === undefined) return; // mapless / positionless - nowhere to fall
  const n = nodeOfPosition(at.x, at.y);
  const anchor = terrain.nodeAtClamped(n.hx, n.hy);

  const index = contentIndex(ctx.content);
  const pool = yields.flatMap((y) => {
    const harvestAtomic = index.goods.get(y.goodType)?.atomics.harvest;
    if (harvestAtomic === undefined) return []; // load-checked (cross-references); never mint unharvestable goods
    const pipeline = index.gatheringPipelinesByGood.get(y.goodType);
    const gfxIndex = (pipeline?.harvest ?? pipeline?.pickup)?.gfxIndices[0];
    return [{ goodType: y.goodType, harvestAtomic, gfxIndex, left: y.amount }];
  });
  const layers = interleavedLayers(pool);
  const head = layers.shift();
  if (head === undefined) return; // nothing resolvable to yield

  // The kill node, or its first free walkable neighbour (canonical N,E,S,W) when something stands there.
  const blocked = dynamicBlockOverlay(world, ctx, terrain);
  const slots: readonly NodeId[] = [anchor, ...terrain.walkableNeighbours(anchor)];
  const node =
    slots.find((s) => !blocked.has(s) && !sowNodeOccupied(world, terrain.xOf(s), terrain.yOf(s))) ?? anchor;

  const e = world.create();
  world.add(e, Position, positionOfNode(terrain.xOf(node), terrain.yOf(node)));
  world.add(e, Resource, {
    goodType: head.goodType,
    remaining: head.amount,
    harvestAtomic: head.harvestAtomic,
    ...(head.gfxIndex !== undefined ? { gfxIndex: head.gfxIndex } : {}),
  });
  if (layers.length > 0) world.add(e, ResourceLayers, { layers });
  stampResourceFootprintOrFallback(world, ctx.content, e, head.goodType);
}

/** The body's extraction sequence: one unit per step, round-robin across the yield goods in authored
 *  order (the cadaver's per-pluck stage flip), merged into same-good runs - a single-good body reads
 *  as one plain run, an exhausted good simply drops out of the rotation. */
function interleavedLayers(
  pool: { goodType: number; harvestAtomic: number; gfxIndex: number | undefined; left: number }[],
): ResourceLayer[] {
  const seq: ResourceLayer[] = [];
  for (
    let active = pool.filter((p) => p.left > 0);
    active.length > 0;
    active = active.filter((p) => p.left > 0)
  ) {
    for (const p of active) {
      p.left--;
      const last = seq[seq.length - 1];
      if (last !== undefined && last.goodType === p.goodType) last.amount++;
      else {
        seq.push({
          goodType: p.goodType,
          amount: 1,
          harvestAtomic: p.harvestAtomic,
          ...(p.gfxIndex !== undefined ? { gfxIndex: p.gfxIndex } : {}),
        });
      }
    }
  }
  return seq;
}
