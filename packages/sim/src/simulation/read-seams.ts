/**
 * Resolves the optional world resources a mapless sim lacks, then delegates to the owning system. The
 * public contract of each seam stays on its `Simulation` method.
 */
import type { ContentSet } from '@open-northland/data';
import { FOG_MODE, type FogMode, fogMode } from '../components/index.js';
import type { World } from '../ecs/world.js';
import type { TerrainGraph } from '../nav/terrain/index.js';
import { type PlayerPlacementProbe, seatPlacementProbe } from '../systems/conflict/contested-ground.js';
import { buildingEnabled } from '../systems/progression/index.js';
import { type SignpostProbe, signpostProbe } from '../systems/signposts/index.js';
import { effectiveFogState, type FogState, maskFogState, viewedFogState } from '../systems/vision/index.js';

/** One viewer player's fog: plain data and one pure accessor over the live {@link FogState}. */
export interface FogView {
  /** The seat whose perspective `stateAt` answers for; a render cache keys on it beside `generation`,
   *  since a spectator may switch seats under one unchanged mask. */
  readonly player: number;
  /** Never `OFF`, which yields a null view instead. */
  readonly mode: FogMode;
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** Bumps only when a mask byte or the mode changed, so render layers use it as a re-composite key. */
  readonly generation: number;
  /** The viewer's effective `FOG_STATE` at a cell, with a RECON map's known-terrain mapping applied. */
  readonly stateAt: (cellX: number, cellY: number) => number;
}

/** Null for a mapless sim. */
export function placementProbeFor(
  world: World,
  content: ContentSet,
  terrain: TerrainGraph | undefined,
  fog: FogState | undefined,
  buildingType: number,
  player?: number,
  tribe?: number,
): PlayerPlacementProbe | null {
  if (terrain === undefined) return null;
  const probe = seatPlacementProbe(world, content, terrain, fog, buildingType, player);
  if (tribe === undefined) return probe;
  const enabled = buildingEnabled(world, { content }, player, tribe, buildingType);
  return {
    ...probe,
    canPlace: (x, y) => enabled && probe.canPlace(x, y),
    contestedKeyWithin: (...bounds) => `${enabled}:${probe.contestedKeyWithin(...bounds)}`,
  };
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
    player,
    mode,
    cellsWide: fog.cellsWide,
    cellsHigh: fog.cellsHigh,
    generation: fog.generation,
    stateAt: (cellX: number, cellY: number) => effectiveFogState(fog, mode, player, cellX, cellY),
  };
}

/** One viewer player's fog as plain data, for a reader on another thread: the raw bytes of the
 *  viewer's vision-group mask (a copy), null while the group has none. {@link fogViewOfMask} reads it. */
export interface FogMaskAnswer {
  readonly player: number;
  readonly mode: FogMode;
  readonly cellsWide: number;
  readonly cellsHigh: number;
  readonly generation: number;
  readonly mask: Uint8Array | null;
}

/** Null when fog is OFF or the sim is mapless, as {@link fogViewFor}. */
export function fogMaskAnswerFor(
  world: World,
  fog: FogState | undefined,
  player: number,
): FogMaskAnswer | null {
  if (fog === undefined) return null;
  const mode = fogMode(world);
  if (mode === FOG_MODE.OFF) return null;
  return {
    player,
    mode,
    cellsWide: fog.cellsWide,
    cellsHigh: fog.cellsHigh,
    generation: fog.generation,
    mask: fog.tryMaskFor(player)?.slice() ?? null,
  };
}

/** The {@link FogView} over a mask answer: the same states `fogViewFor` answers at that generation. */
export function fogViewOfMask(answer: FogMaskAnswer): FogView {
  const { mode, cellsWide, cellsHigh } = answer;
  const mask = answer.mask ?? undefined;
  return {
    player: answer.player,
    mode,
    cellsWide,
    cellsHigh,
    generation: answer.generation,
    stateAt: (cellX: number, cellY: number) =>
      viewedFogState(maskFogState(mask, cellsWide, cellsHigh, cellX, cellY), mode),
  };
}
