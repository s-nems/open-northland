import type { Entity, SimEvent } from '@open-northland/sim';

/**
 * The renderer side of the static→dynamic draw split: the set of entities the built-once static object
 * layer draws (the sim pool skips them), and the two calls that retire one static quad.
 */
export interface StaticDrawSurface<Sprite> {
  /** Held and read per frame by the renderer, so the handover mutates it in place. */
  setStaticallyDrawnRefs(refs: ReadonlySet<number>): void;
  removeMapObject(sprite: Sprite): void;
  adoptFogGhost(entity: number): void;
}

interface Retirement {
  readonly entity: number;
  /** The static quad was this node's fog ghost (a virgin object is its own last-seen state), so a worked
   *  node adopts it to keep its remembered look on explored ground. A razed bush is gone instead. */
  readonly keepsFogGhost: boolean;
}

/** What an event retires from the static layer, or null when it leaves the drawn set alone. */
function retirement(event: SimEvent): Retirement | null {
  switch (event.kind) {
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
 * Bind spawned harvestables to the static quads already drawing them, and return the per-frame event hook
 * that hands one over to the live sim pool the first time it is worked. A virgin node costs nothing per
 * frame (a far zoom-out shows thousands at once); from the handover on, the pool draws the same graphic
 * shrinking with its levels. Null when no placement resolved to a sprite, so the pool draws every node.
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
