import type { EntitySnapshot } from '@open-northland/sim';
import type { ElevationField } from '../../terrain/index.js';
import type { EntityKind, MutableSpriteDrawItem } from '../draw-item.js';

/** Kinds whose draw item reads the entity's own components and the map's elevation alone. */
const SELF_CONTAINED_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'resource',
  'stump',
  'berrybush',
  'chest',
  'stockpile',
  'grounddrop',
  'fish',
]);

export function isSelfContainedKind(kind: EntityKind, isFlag = false): boolean {
  return !isFlag && SELF_CONTAINED_KINDS.has(kind);
}

/** A self-contained entity's anchor, and its item once a build assembled one. */
export interface MemoizedEntity {
  readonly kind: EntityKind;
  readonly tileX: number;
  readonly tileY: number;
  /** Pre-lift screen anchor, the cull point. */
  readonly screen: { readonly x: number; readonly y: number };
  item: MutableSpriteDrawItem | undefined;
}

/** Kinds outside the static run whose own item still reads the entity's own components and the map's
 *  elevation alone. A build emits them each time, since what they stage beside the item (a home's fire,
 *  a post's boards) reads other entities, but an unchanged entity gets the item it already has, which
 *  the pool keeps bound by identity. The scene build adds the settlers standing idle. */
export function ownsItsItem(kind: EntityKind): boolean {
  return kind === 'building' || kind === 'signpost';
}

/** An {@link ownsItsItem} entity's item, the extra items emitted with it and the other entities those
 *  extras were read from: they stand while each of `readIds` still names the entity in `reads`. */
export interface OwnItems {
  readonly item: MutableSpriteDrawItem;
  readonly extras: readonly MutableSpriteDrawItem[];
  readonly readIds: readonly number[];
  readonly reads: readonly (EntitySnapshot | undefined)[];
}

/**
 * The scene build's records of self-contained entities, carried across builds. A mirror replaces the
 * object of an entity whose components changed, so a record keyed by the object is current for as long
 * as the object lives, and an unchanged entity reuses its item. Records hold only while the elevation
 * and owner colours they were built under do.
 */
export class SceneItemMemo {
  private records = new WeakMap<EntitySnapshot, MemoizedEntity>();
  private own = new WeakMap<EntitySnapshot, OwnItems>();
  private elevation: ElevationField | undefined;
  private playerColourOf: ((player: number) => number) | undefined;

  /** Open a build under these inputs, dropping every record when one changed. */
  begin(
    elevation: ElevationField | undefined,
    playerColourOf: ((player: number) => number) | undefined,
  ): void {
    if (elevation === this.elevation && playerColourOf === this.playerColourOf) return;
    this.records = new WeakMap();
    this.own = new WeakMap();
    this.elevation = elevation;
    this.playerColourOf = playerColourOf;
  }

  get(entity: EntitySnapshot): MemoizedEntity | undefined {
    return this.records.get(entity);
  }

  /** The items an {@link ownsItsItem} entity's last emission under these inputs made, if any. */
  ownItems(entity: EntitySnapshot): OwnItems | undefined {
    return this.own.get(entity);
  }

  holdOwnItems(entity: EntitySnapshot, items: OwnItems): void {
    this.own.set(entity, items);
  }

  /** Remember `entity`'s anchor when its kind is self-contained; the record, or undefined. */
  remember(
    entity: EntitySnapshot,
    kind: EntityKind,
    tileX: number,
    tileY: number,
    screen: { readonly x: number; readonly y: number },
  ): MemoizedEntity | undefined {
    if (!isSelfContainedKind(kind, 'DeliveryFlag' in entity.components)) return undefined;
    const record: MemoizedEntity = { kind, tileX, tileY, screen, item: undefined };
    this.records.set(entity, record);
    return record;
  }
}
