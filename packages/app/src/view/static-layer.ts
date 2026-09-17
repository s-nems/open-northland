import type { Entity, SimEvent, WorldSnapshot } from '@open-northland/sim';
import { bindFootprintClearing, type FootprintBuildingType } from './footprint-clearing.js';
import {
  bindHarvestableHandover,
  retireStaticHarvestables,
  type StaticDrawSurface,
} from './harvestable-handover.js';

/** A decoded map's placed landscape objects as the static layer drew them. */
export interface StaticLayerObjects<Sprite> {
  readonly placements: readonly number[];
  readonly byPlacement: ReadonlyMap<number, Sprite>;
}

/**
 * How the map's harvestable placements met the sim: spawned by this boot, each as one entity, or restored
 * from a save, which pool-draws every one from the loaded state. A fresh boot's chests and ground goods
 * are pool-drawn from the start too: only a sim-drawn item is on screen for a click or a tooltip to find.
 */
export type HarvestableSpawn =
  | {
      readonly kind: 'fresh';
      readonly placementByEntity: readonly (readonly [Entity, number])[];
      readonly pooledPlacements: readonly number[];
    }
  | { readonly kind: 'restored'; readonly placements: readonly number[] };

/**
 * Bind the static landscape layer to the sim for the map's lifetime and return the per-frame event
 * hook: harvestables hand over to the sprite pool as they are worked, and building footprints clear the
 * scenery under them. A harvestable's quad stays with its entity, whose razing the handover retires.
 */
export function bindStaticLayer<Sprite>(
  surface: StaticDrawSurface<Sprite>,
  objects: StaticLayerObjects<Sprite>,
  harvestables: HarvestableSpawn,
  content: { readonly buildings: readonly FootprintBuildingType[] },
  snapshot: () => WorldSnapshot,
): (events: readonly SimEvent[]) => void {
  let handover: ((events: readonly SimEvent[]) => void) | null = null;
  const harvestablePlacements = new Set<number>();
  if (harvestables.kind === 'fresh') {
    handover = bindHarvestableHandover(surface, harvestables.placementByEntity, objects.byPlacement);
    for (const [, placement] of harvestables.placementByEntity) harvestablePlacements.add(placement);
    retireStaticHarvestables(surface, harvestables.pooledPlacements, objects.byPlacement);
    for (const placement of harvestables.pooledPlacements) harvestablePlacements.add(placement);
  } else {
    retireStaticHarvestables(surface, harvestables.placements, objects.byPlacement);
    for (const placement of harvestables.placements) harvestablePlacements.add(placement);
  }
  const scenery = new Map<number, Sprite>();
  for (const [placement, sprite] of objects.byPlacement) {
    if (!harvestablePlacements.has(placement)) scenery.set(placement, sprite);
  }
  const clearing = bindFootprintClearing(surface, objects.placements, scenery, content, snapshot);
  return (events) => {
    handover?.(events);
    clearing(events);
  };
}
