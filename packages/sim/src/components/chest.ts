import { defineComponent, type Entity } from '../ecs/world.js';

/** The two chest landscapes (`landscapetypes.ini` 85 `chest_wooden`, 86 `chest_magical`). */
export const CHEST_KINDS = ['wooden', 'magical'] as const;
export type ChestKind = (typeof CHEST_KINDS)[number];

/**
 * A closed treasure chest standing on the map. `contents` is the chest type the map authored on the
 * placement (its `lmlv` value), the key into the sim's chest-contents table; it stays opaque until the
 * chest is opened. A chest carries a `ResourceFootprint` like a resource node, so it blocks and is
 * worked from its record's cells, and it vanishes when opened.
 */
export const Chest = defineComponent<{
  kind: ChestKind;
  contents: number;
  /** Opaque render-variant tag: the `[GfxLandscape]` record the map placed. Absent on a scene spawn. */
  gfxIndex?: number;
}>('Chest', 'economy');

/**
 * A settler's pending "open that chest" order - the `openChest` command's en-route marker. The settler
 * walks to the chest's work cell under a normal `PlayerOrder`, then the open-chest atomic's effect hands
 * out the contents. Dropped when the walk fails, a need interrupts it, or the chest is gone.
 */
export const OpenChestOrder = defineComponent<{ chest: Entity }>('OpenChestOrder', 'settlers');
