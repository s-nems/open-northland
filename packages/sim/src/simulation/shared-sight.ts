import { FOG_MODE, fogMode } from '../components/index.js';
import type { World } from '../ecs/world.js';
import { FOG_STATE, type FogState } from '../systems/vision/index.js';
import { scanChangedBytes } from './changed-bytes.js';
import { type FogMaskAnswer, fogMaskAnswerFor, SHARED_SIGHT_VIEWER } from './read-seams.js';

/** One watched vision group: the player it is read through, its mask as last folded in, and the view
 *  generation that copy stands at. */
interface FoldedGroup {
  readonly player: number;
  readonly copy: Uint8Array;
  generation: number;
}

/**
 * Several players' fog as one mask, for a spectator watching them all: each cell reads the most any of
 * them knows of it (mask bytes rank by knowledge, the script-revealed byte above VISIBLE). It keeps a
 * copy of every watched group's mask, so a vision rebuild re-folds only the cells whose bytes changed
 * in the groups that changed, never the whole map per group.
 */
export class SharedSightMask {
  private seatsKey: string | null = null;
  private groups: FoldedGroup[] = [];
  private union: Uint8Array | null = null;

  /** Null when fog is OFF or the sim is mapless; one player answers as {@link fogMaskAnswerFor}. The
   *  answer's mask is a copy the caller may transfer. */
  answer(world: World, fog: FogState | undefined, players: readonly number[]): FogMaskAnswer | null {
    const [only] = players;
    if (players.length === 1 && only !== undefined) return fogMaskAnswerFor(world, fog, only);
    const mode = fogMode(world);
    if (fog === undefined || mode === FOG_MODE.OFF) return null;
    const union = this.fold(fog, players);
    return {
      player: SHARED_SIGHT_VIEWER,
      mode,
      cellsWide: fog.cellsWide,
      cellsHigh: fog.cellsHigh,
      generation: fog.generation,
      mask: union.slice(),
    };
  }

  private fold(fog: FogState, players: readonly number[]): Uint8Array {
    const cells = fog.cellsWide * fog.cellsHigh;
    const key = players.map((player) => fog.visionGroupOf(player)).join(',');
    if (key !== this.seatsKey || this.union?.length !== cells) return this.refold(fog, players, key, cells);
    const union = this.union;
    for (const group of this.groups) {
      const generation = fog.viewGeneration(group.player);
      if (generation === group.generation) continue;
      group.generation = generation;
      const source = fog.tryMaskFor(group.player) ?? new Uint8Array(cells);
      scanChangedBytes(group.copy, source, (index) => {
        group.copy[index] = source[index] ?? FOG_STATE.UNEXPLORED;
        union[index] = this.mostKnownAt(index);
        return true;
      });
    }
    return union;
  }

  private refold(fog: FogState, players: readonly number[], key: string, cells: number): Uint8Array {
    const seen = new Set<number>();
    this.groups = [];
    for (const player of players) {
      const group = fog.visionGroupOf(player);
      if (seen.has(group)) continue;
      seen.add(group);
      this.groups.push({
        player,
        copy: fog.tryMaskFor(player)?.slice() ?? new Uint8Array(cells),
        generation: fog.viewGeneration(player),
      });
    }
    const union = new Uint8Array(cells);
    for (const { copy } of this.groups) {
      for (let i = 0; i < cells; i++) {
        const byte = copy[i] ?? FOG_STATE.UNEXPLORED;
        if (byte > (union[i] ?? FOG_STATE.UNEXPLORED)) union[i] = byte;
      }
    }
    this.seatsKey = key;
    this.union = union;
    return union;
  }

  private mostKnownAt(index: number): number {
    let most: number = FOG_STATE.UNEXPLORED;
    for (const { copy } of this.groups) most = Math.max(most, copy[index] ?? FOG_STATE.UNEXPLORED);
    return most;
  }
}
