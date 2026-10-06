import type { EntitySnapshot } from '@open-northland/sim';
import type { ElevationField } from '../terrain/index.js';
import type { EntityKind, MutableSpriteDrawItem } from './draw-item.js';

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

export function isSelfContainedKind(kind: EntityKind): boolean {
  return SELF_CONTAINED_KINDS.has(kind);
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

/**
 * The scene build's records of self-contained entities, carried across builds. A mirror replaces the
 * object of an entity whose components changed, so a record keyed by the object is current for as long
 * as the object lives, and an unchanged entity reuses its item. Records hold only while the elevation
 * and owner colours they were built under do.
 */
export class SceneItemMemo {
  private records = new WeakMap<EntitySnapshot, MemoizedEntity>();
  private elevation: ElevationField | undefined;
  private playerColourOf: ((player: number) => number) | undefined;

  /** Open a build under these inputs, dropping every record when one changed. */
  begin(
    elevation: ElevationField | undefined,
    playerColourOf: ((player: number) => number) | undefined,
  ): void {
    if (elevation === this.elevation && playerColourOf === this.playerColourOf) return;
    this.records = new WeakMap();
    this.elevation = elevation;
    this.playerColourOf = playerColourOf;
  }

  get(entity: EntitySnapshot): MemoizedEntity | undefined {
    return this.records.get(entity);
  }

  /** Remember `entity`'s anchor when its kind is self-contained; the record, or undefined. */
  remember(
    entity: EntitySnapshot,
    kind: EntityKind,
    tileX: number,
    tileY: number,
    screen: { readonly x: number; readonly y: number },
  ): MemoizedEntity | undefined {
    if (!SELF_CONTAINED_KINDS.has(kind)) return undefined;
    const record: MemoizedEntity = { kind, tileX, tileY, screen, item: undefined };
    this.records.set(entity, record);
    return record;
  }
}
