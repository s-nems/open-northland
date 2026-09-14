import { defineComponent, type Entity } from '../ecs/world.js';

export const CHEST_KINDS = ['wooden', 'magical'] as const;
export type ChestKind = (typeof CHEST_KINDS)[number];

/** Each kind's `landscapetypes.ini` slug (types 85 and 86 in the base data), the join from a chest to
 *  its landscape record on both the sim and the map side. */
export const CHEST_LANDSCAPE_SLUG: Readonly<Record<ChestKind, string>> = {
  wooden: 'chest_wooden',
  magical: 'chest_magical',
};

/**
 * A closed treasure chest standing on the map. `contents` is the chest type the map authored on the
 * placement (its `lmlv` value), the key into the sim's chest-contents table. A chest carries a
 * `ResourceFootprint` like a resource node, so it blocks and is worked from its record's cells, and it
 * vanishes when opened.
 */
export const Chest = defineComponent<{
  kind: ChestKind;
  contents: number;
  /** The `[GfxLandscape]` record the chest stands on: the footprint's source and the render variant.
   *  Absent only on content shipping no chest record. */
  gfxIndex?: number;
}>('Chest', 'economy');

/**
 * A settler's pending "open that chest" order - the `openChest` command's en-route marker. The settler
 * walks to the chest's work cell under a normal `PlayerOrder`, then the open-chest atomic's effect hands
 * out the contents. Dropped when the walk fails, a need interrupts it, or the chest is gone.
 */
export const OpenChestOrder = defineComponent<{ chest: Entity }>('OpenChestOrder', 'settlers');
