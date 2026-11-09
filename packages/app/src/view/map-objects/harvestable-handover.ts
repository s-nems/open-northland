import type { Entity, SimEvent } from '@open-northland/sim';

import type { SightDeferral } from './sight-deferral.js';

/** The renderer side of the static-to-dynamic draw split: the sim draw pool skips statically drawn refs. */
export interface StaticDrawSurface<Sprite> {
  /** Held and read per frame by the renderer, so the handover mutates it in place - and only ever
   *  deletes from it, an invariant the renderer's scene cache keys on. */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void;
  removeMapObject(sprite: Sprite): void;
}

/** The entities an event retires from the static layer; empty when it leaves the drawn set alone. */
function retirements(event: SimEvent): readonly number[] {
  switch (event.kind) {
    case 'missionLandscapeResourceRemoved':
      return [event.entity];
    case 'resourceFelled':
    case 'resourceMined':
    case 'resourceDepleted':
    case 'treeGrew':
      return [event.node];
    case 'berryForaged':
    case 'berryBushRazed':
      return [event.bush];
    case 'groundCleared':
      return event.razed;
    default:
      return [];
  }
}

export interface HarvestableHandover<Sprite> {
  /** Per-frame hook: hands a worked node over to the live sim pool the first time it is worked. */
  readonly onEvents: (events: readonly SimEvent[]) => void;
  /** The static quad still drawing `entity`, or `undefined` once the pool draws it. A click on the node
   *  hit-tests against this quad, since the pool knows nothing of it. */
  readonly spriteOf: (entity: number) => Sprite | undefined;
  /** Hand `entity` over once the viewer sees its node, as a worked node is. */
  readonly retireWhenSeen: (entity: number) => void;
  /** Each entity still statically drawn, with its placement. */
  readonly held: () => [entity: number, placement: number][];
}

interface HeldQuad<Sprite> {
  readonly sprite: Sprite;
  readonly placement: number;
}

/**
 * Bind spawned harvestables to the static quads already drawing them. A worked node leaves the layer
 * once the viewer sees it, so a node worked in the fog keeps its last-seen quad, and the live pool
 * draws it from then on. Null when no placement resolved to a sprite, leaving every node pool-drawn.
 */
export function bindHarvestableHandover<Sprite>(
  surface: StaticDrawSurface<Sprite>,
  placementByEntity: Iterable<readonly [Entity, number]>,
  spriteByPlacement: ReadonlyMap<number, Sprite>,
  sight: SightDeferral,
  nodeOfPlacement: (placement: number) => { readonly hx: number; readonly hy: number } | undefined,
): HarvestableHandover<Sprite> | null {
  const held = new Map<number, HeldQuad<Sprite>>();
  for (const [entity, placement] of placementByEntity) {
    const sprite = spriteByPlacement.get(placement);
    // A placement whose atlas never resolved has no static sprite: leave that node pool-drawn.
    if (sprite !== undefined) held.set(entity, { sprite, placement });
  }
  if (held.size === 0) return null;

  const refs = new Set(held.keys());
  surface.setStaticallyDrawnRefs(refs);

  const retire = (entity: number): void => {
    const quad = held.get(entity);
    if (quad === undefined) return; // already handed over, or never static (an admin spawn)
    held.delete(entity);
    refs.delete(entity);
    surface.removeMapObject(quad.sprite);
  };
  const retireWhenSeen = (entity: number): void => {
    const quad = held.get(entity);
    if (quad === undefined) return;
    const node = nodeOfPlacement(quad.placement);
    if (node === undefined) retire(entity);
    else sight.defer(quad.placement, node.hx, node.hy, () => retire(entity));
  };
  const onEvents = (events: readonly SimEvent[]): void => {
    for (const event of events) for (const entity of retirements(event)) retireWhenSeen(entity);
  };
  return {
    onEvents,
    spriteOf: (entity) => held.get(entity)?.sprite,
    retireWhenSeen,
    held: () => [...held].map(([entity, quad]) => [entity, quad.placement]),
  };
}

/**
 * Retire every fresh-build harvestable placement's static quad at once: a restored world's nodes are
 * pool-drawn from the loaded state, and a quad left bound would double-draw or resurrect them.
 */
export function retireStaticHarvestables<Sprite>(
  surface: StaticDrawSurface<Sprite>,
  placements: Iterable<number>,
  spriteByPlacement: ReadonlyMap<number, Sprite>,
): void {
  for (const placement of placements) {
    const sprite = spriteByPlacement.get(placement);
    if (sprite !== undefined) surface.removeMapObject(sprite);
  }
}
