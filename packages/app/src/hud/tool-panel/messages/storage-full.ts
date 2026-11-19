import { BUILDING_KIND, type ContentSet } from '@open-northland/data';
import { stockSlotsForType, systems, TICKS_PER_SECOND, type WorldSnapshot } from '@open-northland/sim';
import {
  buildingTypeOf,
  type SnapshotEntity,
  storageCapacityFactorOf,
} from '../../../game/snapshot/index.js';
import { ownedBuildingsOfType } from '../../details-panel/model/building.js';
import { liveAmounts } from '../../details-panel/model/building-materials.js';
import { type MessageNaming, type MessageRaiser, nodeOf } from './raise.js';
import { USER_MESSAGE_TYPE } from './types.js';

/**
 * Ticks a producer must stand on a full shelf of a good the seat's storehouses are full of before the
 * note: a carrier lifting a unit out of a storehouse clears a shorter gap on its own. Approximation.
 */
export const STORAGE_FULL_GRACE_TICKS = 15 * TICKS_PER_SECOND;

/** One product shelf of a producing building type, and the good a storehouse banks the product as. */
export interface ProductShelf {
  readonly goodType: number;
  readonly capacity: number;
  readonly stored: number;
}

/** Where the seat's products go: each producing type's product shelves, and each storehouse type's slot
 *  size per good. */
export interface StorageLayout {
  readonly shelves: ReadonlyMap<number, readonly ProductShelf[]>;
  readonly storehouses: ReadonlyMap<number, ReadonlyMap<number, number>>;
}

/** The storehouses' slots and every product a storehouse slots. A dish that no storehouse slots as
 *  itself is banked as its edible, as the sim's deposit does. The choice is made once for every
 *  storehouse type, where the sim makes it per store: the storehouse types share one slot set. */
export function storageLayoutOf(content: ContentSet): StorageLayout {
  const storehouses = new Map<number, ReadonlyMap<number, number>>();
  for (const b of content.buildings) {
    if (b.kind === BUILDING_KIND.storage) storehouses.set(b.typeId, stockSlotsForType(content, b.typeId));
  }
  const slotted = new Set([...storehouses.values()].flatMap((slots) => [...slots.keys()]));
  const shelves = new Map<number, readonly ProductShelf[]>();
  for (const b of content.buildings) {
    if (storehouses.has(b.typeId) || shelves.has(b.typeId)) continue;
    const products = [...stockSlotsForType(content, b.typeId)].flatMap(([goodType, capacity]) => {
      if (!b.produces.includes(goodType)) return [];
      const stored = slotted.has(goodType) ? goodType : systems.edibleGoodFormOf(content, goodType);
      return slotted.has(stored) ? [{ goodType, capacity, stored }] : [];
    });
    if (products.length > 0) shelves.set(b.typeId, products);
  }
  return { shelves, storehouses };
}

/** One stored good's watch: since when a producer stands for it, the storehouse the note jumps to and
 *  the producer it names. */
interface Watch {
  readonly since: number;
  readonly store: SnapshotEntity;
  readonly producer: SnapshotEntity;
}

/**
 * The goods a producer of the seat cannot make any more: its shelf of the good is full, its worker's
 * diagnosis finds no building that takes the good, and every storehouse that slots it is full, once that
 * has lasted {@link STORAGE_FULL_GRACE_TICKS}. A producer with shelf room, or one that may still carry a
 * unit to a home, is working, so the note waits; it retires as soon as no producer stands so. One note
 * per good speaks for every producer of it. A sweep reads the producers it is handed and the seat's
 * storehouses off maintained indexes.
 */
export class StorageFull {
  private watched = new Map<number, Watch>();
  private swept = false;

  constructor(
    private readonly seat: number,
    private readonly layout: StorageLayout,
  ) {}

  /** The product shelves of `workshop` with no room left. */
  fullShelves(workshop: SnapshotEntity): ProductShelf[] {
    const type = buildingTypeOf(workshop);
    const shelves = type === undefined ? undefined : this.layout.shelves.get(type);
    if (shelves === undefined) return [];
    const stock = liveAmounts(workshop.components.Stockpile);
    return shelves.filter((s) => (stock.get(s.goodType) ?? 0) >= s.capacity);
  }

  /** Judge each stored good the `standing` producers cannot make, and raise a note for each whose
   *  storehouses are full while one has stood so for the grace. */
  sweep(
    snapshot: WorldSnapshot,
    standing: ReadonlyMap<number, readonly SnapshotEntity[]>,
    raiser: MessageRaiser,
    naming: MessageNaming,
  ): void {
    const next = new Map<number, Watch>();
    const stocks = new Map<number, ReadonlyMap<number, number>>();
    for (const [good, producers] of standing) {
      const store = this.fullStoreOf(snapshot, good, stocks);
      if (store === undefined) continue;
      const kept = this.watched.get(good);
      const producer = producers.find((e) => e.id === kept?.producer.id) ?? producers[0];
      if (producer === undefined) continue;
      const watch: Watch = { since: kept?.since ?? snapshot.tick, store, producer };
      next.set(good, watch);
      if (isStanding(watch, snapshot.tick)) raiseStorageFull(raiser, naming, good, watch);
    }
    this.watched = next;
    this.swept = true;
  }

  /** Whether the note about `good` stands: undefined before the first sweep. */
  stands(good: number, tick: number): boolean | undefined {
    if (!this.swept) return undefined;
    const watch = this.watched.get(good);
    return watch !== undefined && isStanding(watch, tick);
  }

  /** The storehouse a note about `good` jumps to when every storehouse of the seat that slots it is full,
   *  the lowest id; undefined when one has room or none slots it. `stocks` reads each store once a sweep. */
  private fullStoreOf(
    snapshot: WorldSnapshot,
    good: number,
    stocks: Map<number, ReadonlyMap<number, number>>,
  ): SnapshotEntity | undefined {
    let first: SnapshotEntity | undefined;
    const factor = storageCapacityFactorOf(snapshot);
    for (const [type, slots] of this.layout.storehouses) {
      const slot = slots.get(good);
      if (slot === undefined || slot <= 0) continue;
      const capacity = slot * factor;
      for (const store of ownedBuildingsOfType(snapshot, this.seat, type)) {
        if (store.components.UnderConstruction !== undefined) continue;
        let stock = stocks.get(store.id);
        if (stock === undefined) {
          stock = liveAmounts(store.components.Stockpile);
          stocks.set(store.id, stock);
        }
        if ((stock.get(good) ?? 0) < capacity) return undefined;
        if (first === undefined || store.id < first.id) first = store;
      }
    }
    return first;
  }
}

function isStanding(watch: Watch, tick: number): boolean {
  return tick - watch.since >= STORAGE_FULL_GRACE_TICKS;
}

/** Raise the note about the seat's storehouses full of `good`, one per good: it jumps to the storehouse
 *  and names the first producer it holds back. */
export function raiseStorageFull(
  raiser: MessageRaiser,
  naming: MessageNaming,
  good: number,
  named: { readonly store: SnapshotEntity; readonly producer: SnapshotEntity },
): void {
  const type = USER_MESSAGE_TYPE.storageFull;
  const storeType = buildingTypeOf(named.store);
  raiser.raise(
    `${type}|good:${good}`,
    {
      type,
      subject: null,
      at: nodeOf(named.store),
      about: good,
      goodType: good,
      technologies: null,
      jobType: null,
      ...(storeType === undefined ? {} : { building: storeType }),
    },
    () =>
      naming.text(type, {
        subjectName: naming.building(named.producer),
        jobLabel: null,
        goodName: naming.technology('good', good) ?? null,
        stanceName: null,
      }),
    true,
  );
}
