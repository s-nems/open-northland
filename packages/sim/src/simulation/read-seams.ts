/**
 * Resolves the optional world resources a mapless sim lacks, then delegates to the owning system. The
 * public contract of each seam stays on its `Simulation` method.
 */
import type { ContentSet } from '@open-northland/data';
import { FOG_MODE, type FogMode, fogMode } from '../components/index.js';
import type { World } from '../ecs/world.js';
import type { TerrainGraph } from '../nav/terrain/index.js';
import { seatPlacementProbe } from '../systems/conflict/contested-ground.js';
import type { PlacementProbe } from '../systems/footprint/index.js';
import { buildingEnabled } from '../systems/progression/index.js';
import { type SignpostProbe, signpostProbe } from '../systems/signposts/index.js';
import {
  effectiveFogState,
  FOG_STATE,
  type FogState,
  maskFogState,
  viewedFogState,
} from '../systems/vision/index.js';

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
  /** The mask bytes {@link stateAt} reads, row-major one per cell, when the view holds a copy nothing
   *  writes to; absent over live state. Under one mode equal bytes read equal states, so a reader can
   *  diff two views' bytes and re-read only the cells that differ. */
  readonly cells?: Uint8Array;
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
  gated = true,
): PlacementProbe | null {
  if (terrain === undefined) return null;
  const probe = seatPlacementProbe(world, content, terrain, fog, buildingType, tribe, player);
  if (tribe === undefined || !gated) return probe;
  const enabled = buildingEnabled(world, { content }, player, tribe, buildingType);
  return { canPlace: (x, y) => enabled && probe.canPlace(x, y) };
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

/** The {@link FogView.player} of a view over several seats' sight together: no seat's own id. */
export const SHARED_SIGHT_VIEWER = -1;

/** Several players' fog as one mask answer, for a spectator watching them all: each cell reads the
 *  most any of them knows of it, so what one sees reads seen. Null when fog is OFF or the sim is
 *  mapless, as {@link fogViewFor}; one player answers as {@link fogMaskAnswerFor}. */
export function sharedFogMaskAnswerFor(
  world: World,
  fog: FogState | undefined,
  players: readonly number[],
): FogMaskAnswer | null {
  const [only] = players;
  if (players.length === 1 && only !== undefined) return fogMaskAnswerFor(world, fog, only);
  if (fog === undefined) return null;
  const mode = fogMode(world);
  if (mode === FOG_MODE.OFF) return null;
  const mask = new Uint8Array(fog.cellsWide * fog.cellsHigh);
  const groups = new Set<number>();
  for (const player of players) {
    const source = fog.tryMaskFor(player);
    if (source === undefined || groups.has(fog.visionGroupOf(player))) continue;
    groups.add(fog.visionGroupOf(player));
    // Mask bytes rank by knowledge, the script-revealed byte above VISIBLE, so the max is the union.
    for (let i = 0; i < mask.length; i++) {
      const byte = source[i] ?? FOG_STATE.UNEXPLORED;
      if (byte > (mask[i] ?? FOG_STATE.UNEXPLORED)) mask[i] = byte;
    }
  }
  return {
    player: SHARED_SIGHT_VIEWER,
    mode,
    cellsWide: fog.cellsWide,
    cellsHigh: fog.cellsHigh,
    generation: fog.generation,
    mask,
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
    ...(mask !== undefined && mask.length === cellsWide * cellsHigh ? { cells: mask } : {}),
  };
}
