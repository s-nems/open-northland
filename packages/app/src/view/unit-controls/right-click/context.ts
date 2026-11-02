import { type ContentSet, lastByTypeId } from '@open-northland/data';
import type { ElevationField } from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import type { ViewerSeat } from '../../../game/viewer-seat.js';
import { type Tile, worldToTile } from '../../picking.js';
import type { PointHits, PointHitTargets } from '../unit-targets.js';

/** What a right click is resolved against, read as it lands. */
export interface RightClickContext {
  readonly snapshot: WorldSnapshot;
  readonly content: ContentSet;
  /** Whose vehicles take the click: the viewer seat's, or any when it watches the whole map. */
  readonly viewer: ViewerSeat;
  readonly asks: RightClickAsks;
}

/**
 * The host answers the click can wait on. Without the trade-stop rule no trader puts a house on its
 * route, without the equip pick list a goods heap is ground, without the mooring rule a ship's group
 * drives in formation, and without the pin rule a right click pins no ship; the others only decide
 * whether the order waits.
 */
export interface RightClickAsks {
  readonly tradeHouse: boolean;
  readonly equip: boolean;
  readonly mooring: boolean;
  readonly attach: boolean;
  readonly formation: boolean;
  readonly pinShip: boolean;
}

/** The modifier keys of the press. */
export interface RightClickMods {
  /** Shift: each order waits behind the current one; a standing setting walks there instead. */
  readonly queued: boolean;
  /** Ctrl (Cmd on a Mac): a docking ship lands its crew once it moors. */
  readonly landsCrew: boolean;
}

/** What lies under the press: the point's targets and the half-cell node a ground order names. */
export interface RightClickHit extends PointHits {
  readonly tile: Tile;
}

export function rightClickHitAt(
  targets: PointHitTargets,
  world: { readonly x: number; readonly y: number },
  elevation: ElevationField | undefined,
): RightClickHit {
  return { ...targets.pointHits(world.x, world.y), tile: worldToTile(world.x, world.y, elevation) };
}

export function rightClickMods(event: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>): RightClickMods {
  return { queued: event.shiftKey, landsCrew: event.ctrlKey || event.metaKey };
}

/** The pending answer a group's order waits on before it is issued. */
export type PendingAnswer = 'attach' | 'tradeAttach' | 'equip' | 'mooring' | 'formation';

interface ContentLookups {
  readonly goods: ReadonlyMap<number, ContentSet['goods'][number]>;
  readonly buildings: ReadonlyMap<number, ContentSet['buildings'][number]>;
  readonly vehicles: ReadonlyMap<number, ContentSet['vehicles'][number]>;
}

const lookups = new WeakMap<ContentSet, ContentLookups>();

/** The content rows by type id, built once per content set, so a resolve per frame allocates none. */
export function contentLookups(content: ContentSet): ContentLookups {
  let found = lookups.get(content);
  if (found === undefined) {
    found = {
      goods: lastByTypeId(content.goods),
      buildings: lastByTypeId(content.buildings),
      vehicles: lastByTypeId(content.vehicles),
    };
    lookups.set(content, found);
  }
  return found;
}
