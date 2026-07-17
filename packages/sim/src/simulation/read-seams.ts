/**
 * The resolution logic behind the {@link import('../simulation.js').Simulation}'s read seams — the
 * sanctioned way app/render observe state instead of reaching into live component stores. Each function
 * resolves the façade's optional world resources (a mapless sim has no terrain graph and no fog) and
 * delegates to the owning system; none mutate, so none affect determinism. The public contract of each
 * seam is documented on its `Simulation` method.
 */
import type { ContentSet } from '@open-northland/data';
import { FOG_MODE, type FogMode, fogMode } from '../components/index.js';
import type { World } from '../ecs/world.js';
import type { TerrainGraph } from '../nav/terrain/index.js';
import { type PlacementProbe, placementProbe } from '../systems/footprint/index.js';
import { type SignpostProbe, signpostProbe } from '../systems/signposts/index.js';
import { effectiveFogState, type FogState } from '../systems/vision/index.js';

export { fogMode, needsEnabled } from '../components/index.js';
export {
  constructionSitePlots,
  placementBlockerVersion,
  workFlagBlockerVersion,
} from '../systems/footprint/index.js';

/**
 * The fog-of-war read view for one viewer player (see {@link import('../simulation.js').Simulation.fogView})
 * — plain data + one pure accessor, so render/minimap layers consume fog without touching the live
 * {@link FogState}.
 */
export interface FogView {
  /** The active {@link import('../components/rules.js').FOG_MODE} (never OFF — OFF yields null). */
  readonly mode: FogMode;
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** Bumps only when the masks rebuilt — the render layers' re-composite key. */
  readonly generation: number;
  /** The viewer's EFFECTIVE `FOG_STATE` at a cell (RECON's known-terrain mapping applied). */
  readonly stateAt: (cellX: number, cellY: number) => number;
}

/** Resolve {@link import('../simulation.js').Simulation.placementProbe} — null for a mapless sim. */
export function placementProbeFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  buildingType: number,
): PlacementProbe | null {
  if (terrain === undefined) return null;
  return placementProbe(world, content, terrain, buildingType);
}

/** Resolve {@link import('../simulation.js').Simulation.signpostProbe} — null for a mapless sim. */
export function signpostProbeFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  player: number,
): SignpostProbe | null {
  if (terrain === undefined) return null;
  return signpostProbe(world, content, terrain, player);
}

/** Resolve {@link import('../simulation.js').Simulation.fogView} — null when fog is OFF or the sim is mapless. */
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
