import { FOG_MODE } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';

/** The tri-state visibility values one mask byte holds. Order matters: a HIGHER state shows more, so
 *  "at least explored" is `>= EXPLORED` — the render + minimap key off these exact bytes. */
export const FOG_STATE = {
  UNEXPLORED: 0,
  EXPLORED: 1,
  VISIBLE: 2,
} as const;

/**
 * The per-player fog masks — a `Simulation`-owned world resource (like the terrain graph), NOT a
 * component. One `Uint8Array` of {@link FOG_STATE} bytes per player that ever owned a positioned
 * entity, allocated lazily (`W×H` cells each); `generation` bumps on every rebuild so render layers
 * re-composite only when the fog actually changed.
 */
export class FogState {
  /** Cell-grid dimensions (the half-cell lattice quartered). */
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** player → per-cell {@link FOG_STATE} bytes. Iterate via {@link playersWithMasks} (ascending) for
   *  any decision/hash — raw Map order is insertion order (history-dependent). */
  private readonly masks = new Map<number, Uint8Array>();
  /**
   * player → the cell bounding box that may still hold VISIBLE bytes — the union of every stamp
   * rect since the last downgrade (REVEAL never downgrades, so there it keeps growing). The
   * downgrade pass scans only this box instead of the whole mask, so rebuild cost follows the
   * players' actual vision coverage, not the map area (golden rule 6). Derived bookkeeping over
   * deterministic stamps — never hashed; VISIBLE cannot exist outside the box by construction
   * (stamps are the only writer of VISIBLE and every stamp merges its rect in).
   */
  private readonly visibleBounds = new Map<
    number,
    { minC: number; maxC: number; minR: number; maxR: number }
  >();
  /** Bumped on every rebuild/reset — the render's re-composite key (a read-path aid, never hashed). */
  generation = 0;
  /** The mode the LAST completed rebuild ran under — combat reads it (visionSystem runs earlier in the
   *  same tick, so it is current), and a change forces an off-cadence rebuild. Starts OFF. */
  activeMode: number = FOG_MODE.OFF;
  /** Tick of the last rebuild, -1 before the first — the cadence anchor. */
  lastRebuildTick = -1;

  constructor(terrain: TerrainGraph, world: World) {
    // The terrain graph is the 2W×2H half-cell lattice; cells quarter it (ceil for odd safety).
    this.cellsWide = Math.max(1, Math.ceil(terrain.width / 2));
    this.cellsHigh = Math.max(1, Math.ceil(terrain.height / 2));
    // The may-hold-VISIBLE boxes are an incrementally-maintained cache, so this registers its verifier
    // on construction (the sim contract: the fuzz harness's `cachesCoherent` invariant tripwires a
    // silent divergence) — self-registration, like every other derived cache in the sim.
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

  /** The players holding a mask, ASCENDING — the canonical iteration order for rebuilds and hashing. */
  playersWithMasks(): number[] {
    return [...this.masks.keys()].sort((a, b) => a - b);
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

  /** Downgrade every VISIBLE byte of `player` to EXPLORED — scans only the may-hold-VISIBLE box,
   *  then clears it (the following stamp pass re-establishes it). Byte-identical to a full-mask
   *  scan (see visibleBounds for why nothing VISIBLE can live outside the box). */
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
   * Verify the may-hold-VISIBLE boxes against the masks — a
   * {@link import('../../ecs/world.js').World} cache-verifier body (`registerCacheVerifier`, the sim
   * contract for incrementally-maintained caches): a VISIBLE byte OUTSIDE its player's box would
   * silently never downgrade, so the fuzz harness's `cachesCoherent` invariant re-derives the
   * invariant here on checked ticks. O(players × cells), verify-only — never on the tick path.
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
   * Mix this state's canonical bytes into a hash — per player ASCENDING, the player id then its raw mask
   * bytes. The masks are simulated state living outside the components, so `Simulation.hashState` calls
   * this after the components; a world that never enabled fog holds no masks and contributes nothing, so
   * every pre-fog hash is byte-identical. Read-only: never allocates a mask.
   */
  hashInto(mix: (n: number) => void): void {
    for (const player of this.playersWithMasks()) {
      mix(player);
      const mask = this.masks.get(player);
      if (mask === undefined) continue; // unreachable — playersWithMasks lists only allocated masks
      for (let i = 0; i < mask.length; i++) mix(mask[i] ?? 0);
    }
  }

  /** The RAW {@link FOG_STATE} of a cell for `player` (out-of-grid / maskless = UNEXPLORED). RECON's
   *  "terrain known from the start" is a VIEW mapping (see effectiveFogState), not raw state. */
  stateAt(player: number, cellX: number, cellY: number): number {
    if (cellX < 0 || cellY < 0 || cellX >= this.cellsWide || cellY >= this.cellsHigh) {
      return FOG_STATE.UNEXPLORED;
    }
    const mask = this.masks.get(player);
    return mask === undefined ? FOG_STATE.UNEXPLORED : (mask[cellY * this.cellsWide + cellX] ?? 0);
  }
}
