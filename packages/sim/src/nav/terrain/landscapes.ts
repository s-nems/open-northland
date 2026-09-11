import type { FootprintCell } from '@open-northland/data';
import type { ResourceNodeSpec } from '../../systems/footprint/resources.js';

export type LandscapeRemovalGroup = 'blocker' | 'fx1' | 'fx2' | 'smoke' | 'wave';

export interface ScriptLandscapeType {
  readonly typeId: number;
  readonly walk: readonly FootprintCell[];
  readonly build: readonly FootprintCell[];
  readonly groups: readonly LandscapeRemovalGroup[];
  readonly resource?: Omit<ResourceNodeSpec, 'x' | 'y' | 'landscapeId'>;
  readonly bushGfxIndex?: number;
}

export interface ScriptLandscapePlacement {
  readonly id: number;
  readonly typeId: number;
  readonly hx: number;
  readonly hy: number;
  readonly level: number;
  /** The associated live resource/bush owns this placement's lifetime and collision. */
  readonly resourceBacked?: boolean;
}

export interface LandscapeMapInput {
  readonly types: readonly ScriptLandscapeType[];
  readonly placements: readonly ScriptLandscapePlacement[];
}
