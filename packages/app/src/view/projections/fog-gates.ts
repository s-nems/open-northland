import { fogTileVisible } from '@open-northland/render';
import { FOG_STATE, type FogView, systems } from '@open-northland/sim';

/**
 * The frame's fog-of-war gate for the human player: one mutable slot, so long-lived consumers close
 * over stable predicates instead of being re-wired per frame. A null fog view means fog off.
 */
export interface FogGates {
  /** Call once at the top of each frame, before any consumer reads a gate. */
  setFrame(fog: FogView | null): void;
  current(): FogView | null;
  visibleTile(tileX: number, tileY: number): boolean;
  /** Whether the viewer sees the cell of a half-cell node. */
  seesNode(col: number, row: number): boolean;
}

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
