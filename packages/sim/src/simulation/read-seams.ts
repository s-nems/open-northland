/**
 * Resolution logic behind `Simulation`'s read seams. Each function resolves the optional world resources
 * a mapless sim lacks and delegates to the owning system; the public contract lives on the seam method.
 */
import type { ContentSet } from '@open-northland/data';
import { FOG_MODE, type FogMode, fogMode } from '../components/index.js';
import type { World } from '../ecs/world.js';
import type { TerrainGraph } from '../nav/terrain/index.js';
import { type PlacementProbe, placementProbe } from '../systems/footprint/index.js';
import { type SignpostProbe, signpostProbe } from '../systems/signposts/index.js';
import { effectiveFogState, type FogState } from '../systems/vision/index.js';

/** One viewer player's fog: plain data and one pure accessor over the live {@link FogState}. */
export interface FogView {
  /** Never `OFF`, which yields a null view instead. */
  readonly mode: FogMode;
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** Bumps only when the masks rebuilt, so render layers use it as a re-composite key. */
  readonly generation: number;
  /** The viewer's effective `FOG_STATE` at a cell, with RECON's known-terrain mapping applied. */
  readonly stateAt: (cellX: number, cellY: number) => number;
}

/** Null for a mapless sim. */
export function placementProbeFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  buildingType: number,
): PlacementProbe | null {
  if (terrain === undefined) return null;
  return placementProbe(world, content, terrain, buildingType);
}

/** Null for a mapless sim. */
export function signpostProbeFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  player: number,
): SignpostProbe | null {
  if (terrain === undefined) return null;
  return signpostProbe(world, content, terrain, player);
}

/** Null when fog is OFF or the sim is mapless. */
export function fogViewFor(world: World, fog: FogState | undefined, player: number): FogView | null {
  if (fog === undefined) return null;
  const mode = fogMode(world);
  if (mode === FOG_MODE.OFF) return null;
  return {
    mode,
    cellsWide: fog.cellsWide,
    cellsHigh: fog.cellsHigh,
    generation: fog.generation,
    stateAt: (cellX: number, cellY: number) => effectiveFogState(fog, mode, player, cellX, cellY),
  };
}
