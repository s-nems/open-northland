import type { OrderMarker, OrderMarkerKind } from '@open-northland/render';
import type { Tile } from '../picking.js';

/** How long one marker plays. Wall-clock, so an order given while paused still lands visibly. */
export const ORDER_MARKER_MS = 650;
/** A burst of Shift-clicks keeps only the newest markers. */
const MAX_MARKERS = 8;

const NONE: readonly OrderMarker[] = [];

/** The ground acknowledgements of the player's walk and march orders: view state only. */
export interface OrderMarkers {
  /** Acknowledge an order at `node`; a second order to the same spot and of the same kind restarts its
   *  marker rather than stacking another. */
  place(node: Tile, kind: OrderMarkerKind): void;
  /** The markers still playing, oldest first. */
  live(): readonly OrderMarker[];
}

interface Placed {
  readonly id: number;
  readonly kind: OrderMarkerKind;
  readonly node: Tile;
  readonly atMs: number;
}

export function createOrderMarkers(now: () => number): OrderMarkers {
  let placed: Placed[] = [];
  let nextId = 1;
  return {
    place: (node, kind) => {
      placed = placed.filter((p) => p.kind !== kind || p.node.col !== node.col || p.node.row !== node.row);
      placed.push({ id: nextId++, kind, node, atMs: now() });
      if (placed.length > MAX_MARKERS) placed.splice(0, placed.length - MAX_MARKERS);
    },
    live: () => {
      if (placed.length === 0) return NONE;
      const nowMs = now();
      placed = placed.filter((p) => nowMs - p.atMs < ORDER_MARKER_MS);
      return placed.map((p) => ({
        id: p.id,
        kind: p.kind,
        hx: p.node.col,
        hy: p.node.row,
        progress: Math.max(0, nowMs - p.atMs) / ORDER_MARKER_MS,
      }));
    },
  };
}
