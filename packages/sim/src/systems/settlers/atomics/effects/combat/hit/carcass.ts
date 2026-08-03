import {
  KilledBy,
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
 * A hunter's lethal blow on huntable prey leaves one carcass node. Authored: one body, one decal - the head
 * of the yield table becomes a harvestable {@link Resource}, the rest queue as {@link ResourceLayers}, and
 * each layer carries its good's cadaver decal index (`Resource.gfxIndex`, opaque to the sim), so the decal
 * flips as the hunter works down the body. The body is player-neutral ground that names its killer through
 * {@link KilledBy}, the claim that keeps a fellow hunter off it.
 */
export function spawnCarcasses(world: World, ctx: SystemContext, attacker: Entity, target: Entity): void {
  const hunter = world.tryGet(attacker, Settler);
  if (hunter === undefined || !isHunterJob(ctx.content, hunter.jobType)) return;
  const prey = world.tryGet(target, Settler);
  if (prey === undefined) return;
  const yields = huntYieldsOf(ctx.content, prey.tribe);
  if (yields === null) return; // not huntable prey - no carcass
  const terrain = ctx.terrain;
  const at = world.tryGet(target, Position);
  if (terrain === undefined || at === undefined) return; // mapless - nowhere to fall
  const n = nodeOfPosition(at.x, at.y);
  const anchor = terrain.nodeAtClamped(n.hx, n.hy);

  const index = contentIndex(ctx.content);
  const pool = yields.flatMap((y) => {
    const harvestAtomic = index.goods.get(y.goodType)?.atomics.harvest;
    if (harvestAtomic === undefined) return []; // load-checked; never mint an unharvestable good
    const pipeline = index.gatheringPipelinesByGood.get(y.goodType);
    const gfxIndex = (pipeline?.harvest ?? pipeline?.pickup)?.gfxIndices[0];
    return [{ goodType: y.goodType, harvestAtomic, gfxIndex, left: y.amount }];
  });
  const layers = interleavedLayers(pool);
  const head = layers.shift();
  if (head === undefined) return;

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
  world.add(e, KilledBy, { by: attacker });
  if (layers.length > 0) world.add(e, ResourceLayers, { layers });
  stampResourceFootprintOrFallback(world, ctx.content, e, head.goodType);
}

/** The body's extraction sequence: one unit per step, round-robin over the yield goods in authored order,
 *  merged into same-good runs. An exhausted good drops out of the rotation. */
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
