import { fogTileExplored, fogTileVisible } from '@open-northland/render';
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
  /** Whether the viewer ever explored the ground at a tile: terrain stays shown under the grey. */
  exploredTile(tileX: number, tileY: number): boolean;
  /** Bumps whenever a gate may answer differently: the fog turned on or off, its mask changed, or it
   *  speaks for another seat. A cache over the gates keys on it. */
  revision(): number;
  /** Whether the viewer sees the cell of a half-cell node. */
  seesNode(col: number, row: number): boolean;
}

export function createFogGates(): FogGates {
  let frameFog: FogView | null = null;
  let revision = 0;
  return {
    setFrame(fog) {
      const changed =
        fog === null || frameFog === null
          ? fog !== frameFog
          : fog.generation !== frameFog.generation || fog.player !== frameFog.player;
      if (changed) revision++;
      frameFog = fog;
    },
    current: () => frameFog,
    visibleTile: (tileX, tileY) => frameFog === null || fogTileVisible(frameFog, tileX, tileY),
    exploredTile: (tileX, tileY) => frameFog === null || fogTileExplored(frameFog, tileX, tileY),
    revision: () => revision,
    seesNode: (col, row) => {
      if (frameFog === null) return true;
      const { cx, cy } = systems.cellOfNode(col, row);
      return frameFog.stateAt(cx, cy) === FOG_STATE.VISIBLE;
    },
  };
}
