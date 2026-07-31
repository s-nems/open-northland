import { Position, Resource, Settler } from '../../../../../../components/index.js';
import { contentIndex } from '../../../../../../core/content-index.js';
import type { Entity, World } from '../../../../../../ecs/world.js';
import { nodeOfPosition, positionOfNode } from '../../../../../../nav/halfcell.js';
import type { NodeId, TerrainGraph } from '../../../../../../nav/terrain/index.js';
import type { SystemContext } from '../../../../../context.js';
import { sowNodeOccupied } from '../../../../../economy/fields.js';
import { dynamicBlockOverlay, stampResourceFootprintOrFallback } from '../../../../../footprint/index.js';
import { huntYieldsOf, isHunterJob } from '../../../../../readviews/index.js';

/**
 * The hunter's kill payoff - a **hunter**'s lethal blow on huntable prey leaves the prey's carcass on
 * the ground as harvestable {@link Resource} nodes, one per {@link huntYieldsOf} entry (meat, and the
 * species' hides/wool), each holding its yield. The hunter then works them with the good's own harvest
 * atomic (`harvest_cadaver`, the original's `setatomic 15 33` chain) through the ordinary gatherer
 * machinery: one unit per pluck onto the back, carried off over several trips, the node reaped when
 * drained. Models the original's cadaver-decal pipeline (`landscapetype` 79/80 with `[GfxLandscape]`
 * 847/848); the per-species contents come from the authored {@link HuntPrey} table (source basis
 * "Hunter prey and carcass yields").
 *
 * Placement: the first node lands where the prey fell; further nodes take the first free walkable
 * neighbour ({@link TerrainGraph.walkableNeighbours}, canonical order) so the decals don't stack, and
 * fall back to the kill node when hemmed in (goods are never dropped). A node is "free" when nothing
 * stands on it ({@link sowNodeOccupied}, the shared occupancy rule) and the walk overlay doesn't block
 * it. Carcasses are unowned, like every standing resource - a kill on shared ground is shared game.
 *
 * Each node carries the good's cadaver decal index as its render-variant tag when its pipeline stage
 * names one (`Resource.gfxIndex` - opaque to the sim): that is how the merged real content's wool row,
 * which rides the leather cadaver stage, draws the right decal even though the render's per-good
 * binding is built from the raw IR rows and has no wool entry.
 *
 * No-ops unless the attacker is a hunter and the target is a huntable-prey animal; mapless worlds
 * (fixture combat tests) spawn nothing. Pure over content + entity state - no RNG, no wall-clock.
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
  // The kill node first, then its walkable neighbours (canonical N,E,S,W): each yield good takes the
  // first still-free slot. `sowNodeOccupied` reads the live resource index, so a node this loop just
  // filled rejects the next good; the walk overlay is re-read per good for the same reason (the stamp
  // below mutates the cache a held view would alias - inert while carcass records are block-free, but
  // never rely on it).
  const slots: readonly NodeId[] = [anchor, ...terrain.walkableNeighbours(anchor)];
  const index = contentIndex(ctx.content);
  for (const y of yields) {
    const harvestAtomic = index.goods.get(y.goodType)?.atomics.harvest;
    if (harvestAtomic === undefined) continue; // load-checked (cross-references); never mint unharvestable goods
    const blocked = dynamicBlockOverlay(world, ctx, terrain);
    const node =
      slots.find((s) => !blocked.has(s) && !sowNodeOccupied(world, terrain.xOf(s), terrain.yOf(s))) ?? anchor;
    const pipeline = index.gatheringPipelinesByGood.get(y.goodType);
    const gfxIndex = (pipeline?.harvest ?? pipeline?.pickup)?.gfxIndices[0];
    const e = world.create();
    world.add(e, Position, positionOfNode(terrain.xOf(node), terrain.yOf(node)));
    world.add(e, Resource, {
      goodType: y.goodType,
      remaining: y.amount,
      harvestAtomic,
      ...(gfxIndex !== undefined ? { gfxIndex } : {}),
    });
    stampResourceFootprintOrFallback(world, ctx.content, e, y.goodType);
  }
}
