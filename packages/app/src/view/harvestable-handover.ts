import type { Entity, SimEvent } from '@open-northland/sim';

/** The renderer side of the static-to-dynamic draw split: the sim draw pool skips statically drawn refs. */
export interface StaticDrawSurface<Sprite> {
  /** Held and read per frame by the renderer, so the handover mutates it in place - and only ever
   *  deletes from it, an invariant the renderer's scene cache keys on. */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void;
  removeMapObject(sprite: Sprite): void;
  adoptFogGhost(entity: number): void;
}

interface Retirement {
  readonly entity: number;
  /** A worked node adopts the retired quad as its fog ghost; a razed bush leaves none. */
  readonly keepsFogGhost: boolean;
}

/** What an event retires from the static layer, or null when it leaves the drawn set alone. */
function retirement(event: SimEvent): Retirement | null {
  switch (event.kind) {
    case 'missionLandscapeResourceRemoved':
      return { entity: event.entity, keepsFogGhost: false };
    case 'resourceFelled':
    case 'resourceMined':
    case 'resourceDepleted':
      return { entity: event.node, keepsFogGhost: true };
    case 'berryForaged':
      return { entity: event.bush, keepsFogGhost: true };
    case 'berryBushRazed':
      return { entity: event.bush, keepsFogGhost: false };
    default:
      return null;
  }
}

/**
 * Bind spawned harvestables to the static quads already drawing them, and return the per-frame event
 * hook that hands one over to the live sim pool the first time it is worked. Null when no placement
 * resolved to a sprite, leaving every node pool-drawn.
 */
export function bindHarvestableHandover<Sprite>(
  surface: StaticDrawSurface<Sprite>,
  placementByEntity: Iterable<readonly [Entity, number]>,
  spriteByPlacement: ReadonlyMap<number, Sprite>,
): ((events: readonly SimEvent[]) => void) | null {
  const held = new Map<number, Sprite>();
  for (const [entity, placement] of placementByEntity) {
    const sprite = spriteByPlacement.get(placement);
    // A placement whose atlas never resolved has no static sprite: leave that node pool-drawn.
    if (sprite !== undefined) held.set(entity, sprite);
  }
  if (held.size === 0) return null;

  const refs = new Set(held.keys());
  surface.setStaticallyDrawnRefs(refs);

  return (events) => {
    for (const event of events) {
      const retires = retirement(event);
      if (retires === null) continue;
      const sprite = held.get(retires.entity);
      if (sprite === undefined) continue; // already handed over, or never static (an admin spawn)
      held.delete(retires.entity);
      refs.delete(retires.entity);
      surface.removeMapObject(sprite);
      if (retires.keepsFogGhost) surface.adoptFogGhost(retires.entity);
    }
  };
}

/**
 * Retire every fresh-build harvestable placement's static quad at once: a restored world's nodes are
 * pool-drawn from the loaded state, and a quad left bound would double-draw or resurrect them.
 * Approximation: nodes worked before the save leave no fog ghost here, where a continuous session
 * keeps showing the dimmed quad under stale fog.
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
