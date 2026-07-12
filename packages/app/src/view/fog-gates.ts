import { fogTileVisible } from '@vinland/render';
import { FOG_STATE, type FogView, systems } from '@vinland/sim';

/**
 * The frame's fog-of-war gate for the HUMAN player — ONE mutable slot refreshed at the top of every
 * frame ({@link FogGates.setFrame}), so long-lived consumers (unit picking, the pile tooltip, the
 * placement gate, voice chatter) close over STABLE predicates instead of being re-wired per frame.
 * Null = fog off (everything shows).
 */
export interface FogGates {
  /** Refresh the frame's fog view. Call once at the top of each frame before any consumer reads a gate. */
  setFrame(fog: FogView | null): void;
  /** The current frame's fog view (null = fog off) — for consumers that need the raw view, not a predicate. */
  current(): FogView | null;
  /** Whether the viewer currently SEES a fractional tile — the picking/tooltip/audio gate. */
  visibleTile(tileX: number, tileY: number): boolean;
  /** Whether the viewer currently SEES a half-cell node's cell — the placement gate's coordinate space. */
  seesNode(col: number, row: number): boolean;
}

/** Create the per-frame fog gate. See {@link FogGates}. */
export function createFogGates(): FogGates {
  let frameFog: FogView | null = null;
  return {
    setFrame(fog) {
      frameFog = fog;
    },
    current: () => frameFog,
    visibleTile: (tileX, tileY) => frameFog === null || fogTileVisible(frameFog, tileX, tileY),
    seesNode: (col, row) => {
      if (frameFog === null) return true;
      const { cx, cy } = systems.cellOfNode(col, row);
      return frameFog.stateAt(cx, cy) === FOG_STATE.VISIBLE;
    },
  };
}
