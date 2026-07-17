import type { SettlerIdentity } from '../../components/index.js';
import type { Entity, World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';
import { atOrWalk, PILEUP_ATOMIC_ID, startAtomic, startPickup } from '../agents/actions.js';
import { interactionCell } from '../agents/targets/index.js';
import type { SystemContext } from '../context.js';
import { atomicDuration } from '../readviews/animations.js';

// The two food-haul steps a woman's drives are built from — carry a held unit into her home larder, or
// walk to a store and lift one. Shared by the child order's larder-stocking stage (./children.ts) and the
// standing hoarding drive (./hoard.ts); neither owns them. Mapless fixtures act in place (no cells to walk).

/** Carry the held food unit home and pile it into the larder. */
export function deliverHome(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  settler: SettlerIdentity,
  home: Entity,
  hereNode: { hx: number; hy: number },
): void {
  const pileUp = (): void => {
    startAtomic(
      world,
      e,
      PILEUP_ATOMIC_ID,
      { kind: 'pileup', store: home },
      atomicDuration(ctx.content, settler, PILEUP_ATOMIC_ID),
      home,
    );
  };
  if (terrain === undefined) {
    pileUp();
    return;
  }
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, home, here), pileUp);
}

/** Walk to the found food store and lift one unit. */
export function fetchFrom(
  world: World,
  ctx: SystemContext,
  terrain: TerrainGraph | undefined,
  e: Entity,
  settler: SettlerIdentity,
  source: { store: Entity; goodType: number },
  hereNode: { hx: number; hy: number },
): void {
  const lift = (): void => startPickup(world, ctx, e, settler, source.store, source.goodType, 1);
  if (terrain === undefined) {
    lift();
    return;
  }
  const here = terrain.nodeAtClamped(hereNode.hx, hereNode.hy);
  atOrWalk(world, e, here, interactionCell(world, ctx, terrain, source.store, here), lift);
}
