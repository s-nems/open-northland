import { FOG_MODE } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';

/** The tri-state visibility values one mask byte holds. Order matters: a higher state shows more, so
 *  "at least explored" is `>= EXPLORED`, and render and minimap key off these exact bytes. */
export const FOG_STATE = {
  UNEXPLORED: 0,
  EXPLORED: 1,
  VISIBLE: 2,
} as const;

/**
 * The per-player fog masks, a `Simulation`-owned world resource rather than a component: one lazily
 * allocated `W×H` array of {@link FOG_STATE} bytes per player that ever owned a positioned entity.
 * `generation` bumps on every rebuild so render layers re-composite only when the fog changed.
 */
export class FogState {
  /** Cell-grid dimensions (the half-cell lattice quartered). */
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** player → per-cell {@link FOG_STATE} bytes. Iterate through {@link playersWithMasks} for any decision
   *  or hash; raw Map order is insertion order, so it is history-dependent. */
  private readonly masks = new Map<number, Uint8Array>();
  /**
   * player → the cell box that may still hold VISIBLE bytes, the union of every stamp rect since the last
   * downgrade. The downgrade pass scans only this box, so rebuild cost follows vision coverage rather than
   * map area. Derived bookkeeping, never hashed: stamps are the only writer of VISIBLE and each merges its
   * rect in, so VISIBLE cannot exist outside the box.
   */
  private readonly visibleBounds = new Map<
    number,
    { minC: number; maxC: number; minR: number; maxR: number }
  >();
  /** Bumped on every rebuild or reset; a read-path aid for re-compositing, never hashed. */
  generation = 0;
  /** The mode the last completed rebuild ran under; a change forces an off-cadence rebuild. */
  activeMode: number = FOG_MODE.OFF;
  /** Tick of the last rebuild, -1 before the first. */
  lastRebuildTick = -1;

  constructor(terrain: TerrainGraph, world: World) {
    // The terrain graph is the 2W×2H half-cell lattice; cells quarter it (ceil for odd safety).
    this.cellsWide = Math.max(1, Math.ceil(terrain.width / 2));
    this.cellsHigh = Math.max(1, Math.ceil(terrain.height / 2));
    // The may-hold-VISIBLE boxes are incrementally maintained, so the verifier registers here for the
    // fuzz harness's `cachesCoherent` invariant.
    world.registerCacheVerifier('fogVisibleBounds', () => this.verifyVisibleBounds());
  }

  /** The mask for `player`, allocated (all UNEXPLORED) on first use. */
  maskFor(player: number): Uint8Array {
    let mask = this.masks.get(player);
    if (mask === undefined) {
      mask = new Uint8Array(this.cellsWide * this.cellsHigh);
      this.masks.set(player, mask);
    }
    return mask;
  }

  /** The mask for `player` if it ever saw anything, else undefined (a maskless player sees nothing). */
  tryMaskFor(player: number): Uint8Array | undefined {
    return this.masks.get(player);
  }

  /** The players holding a mask, ASCENDING - the canonical iteration order for rebuilds and hashing. */
  playersWithMasks(): number[] {
    return [...this.masks.keys()].sort((a, b) => a - b);
  }

  /** Restore seam: adopt a saved mask verbatim and rebuild the player's may-hold-VISIBLE box from
   *  its bytes - derived bookkeeping is recomputed, never loaded. */
  restoreMask(player: number, mask: Uint8Array): void {
    const cells = this.cellsWide * this.cellsHigh;
    if (mask.length !== cells) {
      throw new Error(`fog mask for player ${player} holds ${mask.length} bytes, the grid ${cells} cells`);
    }
    this.masks.set(player, mask);
    for (let r = 0; r < this.cellsHigh; r++) {
      for (let c = 0; c < this.cellsWide; c++) {
        if (mask[r * this.cellsWide + c] === FOG_STATE.VISIBLE) {
          this.mergeVisibleBounds(player, c, c, r, r);
        }
      }
    }
  }

  /** Drop every mask (fog switched OFF): exploration history resets, generation bumps once. */
  reset(): void {
    if (this.masks.size === 0) return;
    this.masks.clear();
    this.visibleBounds.clear();
    this.generation++;
  }

  /** Merge a stamp's touched cell rect into `player`'s may-hold-VISIBLE box (see visibleBounds). */
  mergeVisibleBounds(player: number, minC: number, maxC: number, minR: number, maxR: number): void {
    const b = this.visibleBounds.get(player);
    if (b === undefined) {
      this.visibleBounds.set(player, { minC, maxC, minR, maxR });
      return;
    }
    if (minC < b.minC) b.minC = minC;
    if (maxC > b.maxC) b.maxC = maxC;
    if (minR < b.minR) b.minR = minR;
    if (maxR > b.maxR) b.maxR = maxR;
  }

  /** Downgrade every VISIBLE byte of `player` to EXPLORED, scanning only the may-hold-VISIBLE box and
   *  then clearing it. Byte-identical to a full-mask scan. */
  downgradeVisible(player: number): void {
    const b = this.visibleBounds.get(player);
    if (b === undefined) return;
    const mask = this.masks.get(player);
    if (mask !== undefined) {
      for (let r = b.minR; r <= b.maxR; r++) {
        const base = r * this.cellsWide;
        for (let c = b.minC; c <= b.maxC; c++) {
          if (mask[base + c] === FOG_STATE.VISIBLE) mask[base + c] = FOG_STATE.EXPLORED;
        }
      }
    }
    this.visibleBounds.delete(player);
  }

  /**
   * Verify the may-hold-VISIBLE boxes against the masks: a VISIBLE byte outside its player's box would
   * silently never downgrade. A `registerCacheVerifier` body, so it runs on checked ticks only, never on
   * the tick path.
   */
  verifyVisibleBounds(): string[] {
    const violations: string[] = [];
    for (const player of this.playersWithMasks()) {
      const mask = this.masks.get(player);
      if (mask === undefined) continue;
      const b = this.visibleBounds.get(player);
      for (let r = 0; r < this.cellsHigh; r++) {
        for (let c = 0; c < this.cellsWide; c++) {
          if (mask[r * this.cellsWide + c] !== FOG_STATE.VISIBLE) continue;
          if (b === undefined || c < b.minC || c > b.maxC || r < b.minR || r > b.maxR) {
            violations.push(`fog: player ${player} VISIBLE cell (${c}, ${r}) outside its bounds box`);
          }
        }
      }
    }
    return violations;
  }

  /**
   * Mix this state's canonical bytes into a hash, per player ascending: the player id then its raw mask
   * bytes. A world that never enabled fog holds no masks and contributes nothing, so every pre-fog hash
   * stays byte-identical.
   */
  hashInto(mix: (n: number) => void): void {
    for (const player of this.playersWithMasks()) {
      mix(player);
      const mask = this.masks.get(player);
      if (mask === undefined) continue; // unreachable - playersWithMasks lists only allocated masks
      for (let i = 0; i < mask.length; i++) mix(mask[i] ?? 0);
    }
  }

  /** The raw {@link FOG_STATE} of a cell for `player`; out of grid or maskless reads UNEXPLORED. RECON's
   *  terrain-known-from-the-start is a view mapping in `effectiveFogState`, not raw state. */
  stateAt(player: number, cellX: number, cellY: number): number {
    if (cellX < 0 || cellY < 0 || cellX >= this.cellsWide || cellY >= this.cellsHigh) {
      return FOG_STATE.UNEXPLORED;
    }
    const mask = this.masks.get(player);
    return mask === undefined ? FOG_STATE.UNEXPLORED : (mask[cellY * this.cellsWide + cellX] ?? 0);
  }
}
