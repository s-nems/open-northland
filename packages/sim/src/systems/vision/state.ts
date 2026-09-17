import { FOG_MODE, isValidPlayer } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import { type HalfCellNode, hexDistanceBetween } from '../../nav/halfcell.js';
import type { TerrainGraph } from '../../nav/terrain/index.js';

/** The tri-state visibility values a read returns. Order matters: a higher state shows more, so
 *  "at least explored" is `>= EXPLORED`, and render and minimap key off these exact values. */
export const FOG_STATE = {
  UNEXPLORED: 0,
  EXPLORED: 1,
  VISIBLE: 2,
} as const;

/** The fourth mask byte, a cell a script revealed: {@link FogState.stateAt} returns it as VISIBLE, and
 *  the RECON downgrade lowers VISIBLE bytes alone, so the sight lasts. Raw mask readers (the stamp, the
 *  save digits, the hash) see the byte itself. */
export const REVEALED_BYTE = 3;

/** The number of distinct mask byte values, the stride that keeps one cell's fold contributions apart
 *  from its neighbours'. */
const MASK_BYTE_COUNT = REVEALED_BYTE + 1;

/**
 * One player's mask fold: the XOR of every non-UNEXPLORED cell's {@link cellFold}. Boxed so a stamp
 * updates it without a per-cell lookup, and order-independent, so it is a pure function of the mask's
 * bytes however they were written.
 */
export interface FogFold {
  value: number;
}

/** One cell's contribution to its player's fold. UNEXPLORED contributes nothing, so a freshly allocated
 *  mask folds to 0. The splitmix32 finalizer avalanches the index, or two cells trading states would
 *  cancel out. */
function cellFold(index: number, state: number): number {
  if (state === FOG_STATE.UNEXPLORED) return 0;
  let h = (index * MASK_BYTE_COUNT + state) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Fold `index`'s move from `from` to `to` into `fold`; XOR is its own inverse, so the old contribution
 *  cancels and the new one lands. */
export function foldCellChange(fold: FogFold, index: number, from: number, to: number): void {
  fold.value = (fold.value ^ cellFold(index, from) ^ cellFold(index, to)) >>> 0;
}

/**
 * The fog masks, a `Simulation`-owned world resource rather than a component: one lazily allocated
 * `W×H` array of mask bytes ({@link FOG_STATE} or {@link REVEALED_BYTE}) per vision group that ever
 * owned a positioned entity or received a script's reveal. A
 * vision group is one player, or the players a `setSharedVision` command joined, keyed by its lowest
 * member; every player-keyed accessor resolves the player to its group first. `generation` bumps on
 * every rebuild so render layers re-composite only when the fog changed.
 */
export class FogState {
  /** Cell-grid dimensions (the half-cell lattice quartered). */
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** vision group → per-cell mask bytes. Iterate through {@link groupsWithMasks} for any decision or
   *  hash; raw Map order is insertion order, so it is history-dependent. */
  private readonly masks = new Map<number, Uint8Array>();
  /** player → its vision group, held for every member of a shared group, ascending by player; a player
   *  without an entry is its own group. Shared vision is an authored rule: the original keeps one
   *  explored bit per player and its display reads the local player's bit alone. */
  private groupOf = new Map<number, number>();
  /**
   * vision group → the cell box that may still hold VISIBLE bytes, the union of every stamp rect and
   * restored VISIBLE cell since the last downgrade. The downgrade pass scans only this box, so rebuild
   * cost follows vision coverage rather than map area. Derived bookkeeping, never hashed: the stamp and
   * the restore are the only writers of VISIBLE and each merges its cells in, and nothing lowers a
   * revealed byte to VISIBLE, so VISIBLE cannot exist outside the box.
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
  /** vision group → mask fold, maintained only while a sync digest is on; the masks are far too large
   *  to fold from scratch each tick. */
  private folds: Map<number, FogFold> | null = null;

  constructor(terrain: TerrainGraph, world: World) {
    // The terrain graph is the 2W×2H half-cell lattice; cells quarter it (ceil for odd safety).
    this.cellsWide = Math.max(1, Math.ceil(terrain.width / 2));
    this.cellsHigh = Math.max(1, Math.ceil(terrain.height / 2));
    // The may-hold-VISIBLE boxes are incrementally maintained, so the verifier registers here for the
    // fuzz harness's `cachesCoherent` invariant.
    world.registerCacheVerifier('fogVisibleBounds', () => this.verifyVisibleBounds());
  }

  /** Start maintaining the mask folds, seeded from the masks as they stand: one walk, so a session that
   *  turns the digest on mid-run does not carry an empty fold. Idempotent. */
  startFolding(): void {
    if (this.folds !== null) return;
    this.folds = new Map<number, FogFold>();
    for (const group of this.groupsWithMasks()) {
      const mask = this.masks.get(group);
      if (mask === undefined) continue; // unreachable - groupsWithMasks lists only allocated masks
      const fold = { value: 0 };
      for (let i = 0; i < mask.length; i++) {
        foldCellChange(fold, i, FOG_STATE.UNEXPLORED, mask[i] ?? FOG_STATE.UNEXPLORED);
      }
      this.folds.set(group, fold);
    }
  }

  /** Stop maintaining the folds; a later {@link startFolding} rebuilds them from the masks. */
  stopFolding(): void {
    this.folds = null;
  }

  /** The fold of `player`'s group mask to update while writing its cells, or null while no digest folds
   *  the fog. An all-UNEXPLORED mask folds to 0, so a fresh box needs no walk. */
  foldFor(player: number): FogFold | null {
    if (this.folds === null) return null;
    const group = this.visionGroupOf(player);
    let fold = this.folds.get(group);
    if (fold === undefined) {
      fold = { value: 0 };
      this.folds.set(group, fold);
    }
    return fold;
  }

  /** Mix the shared-vision table, then the fold of every group's mask, ascending, plus the two cadence
   *  fields, which {@link hashInto} leaves out - the digest is the stricter of the two here. The mask
   *  bytes themselves stay out: they are what the folds stand in for. */
  syncFoldInto(mix: (n: number) => void): void {
    mix(this.activeMode);
    mix(this.lastRebuildTick);
    this.hashGroupsInto(mix);
    for (const group of this.groupsWithMasks()) {
      mix(group);
      mix(this.folds?.get(group)?.value ?? 0);
    }
  }

  /**
   * Join `players` into one vision group, together with any group a listed player already belongs to.
   * An invalid slot is skipped; fewer than two distinct valid players change nothing. Masks already
   * explored are dropped, so exploration restarts under the new grouping, as a switch to OFF does; the
   * command is a setup rule, so a live session never pays that.
   */
  shareVision(players: readonly number[]): void {
    const joined = new Set<number>();
    for (const player of players) {
      if (!isValidPlayer(player)) continue;
      for (const member of this.visionGroupMembers(player)) joined.add(member);
    }
    if (joined.size < 2) return;
    const members = [...joined].sort((a, b) => a - b);
    const key = members[0] ?? 0;
    if (members.every((member) => this.groupOf.get(member) === key)) return;
    const table = new Map(this.groupOf);
    for (const member of members) table.set(member, key);
    this.groupOf = new Map([...table].sort(([a], [b]) => a - b));
    this.reset();
    this.lastRebuildTick = -1;
  }

  /** The vision group `player` reads and writes: the lowest member of its shared group, else itself. */
  visionGroupOf(player: number): number {
    return this.groupOf.get(player) ?? player;
  }

  /** The players sharing `player`'s vision group, ascending; a group nobody joined holds its own
   *  player. */
  visionGroupMembers(player: number): number[] {
    const group = this.visionGroupOf(player);
    const members: number[] = [];
    for (const [member, key] of this.groupOf) if (key === group) members.push(member);
    return members.length === 0 ? [group] : members;
  }

  /** Every shared group as its ascending members, ascending by group - the save's `sharedVision` rows. */
  sharedVisionGroups(): number[][] {
    const groups = new Map<number, number[]>();
    for (const [player, key] of this.groupOf) {
      const members = groups.get(key);
      if (members === undefined) groups.set(key, [player]);
      else members.push(player);
    }
    return [...groups.values()];
  }

  /** The mask of `player`'s group, allocated (all UNEXPLORED) on first use. */
  maskFor(player: number): Uint8Array {
    const group = this.visionGroupOf(player);
    let mask = this.masks.get(group);
    if (mask === undefined) {
      mask = new Uint8Array(this.cellsWide * this.cellsHigh);
      this.masks.set(group, mask);
    }
    return mask;
  }

  /** The mask of `player`'s group if it ever saw anything, else undefined (a maskless group sees
   *  nothing). */
  tryMaskFor(player: number): Uint8Array | undefined {
    return this.masks.get(this.visionGroupOf(player));
  }

  /** The vision groups holding a mask, ASCENDING - the canonical iteration order for rebuilds and
   *  hashing. */
  groupsWithMasks(): number[] {
    return [...this.masks.keys()].sort((a, b) => a - b);
  }

  /** Restore seam: adopt a saved mask verbatim under its vision group and rebuild the group's
   *  may-hold-VISIBLE box from its bytes - derived bookkeeping is recomputed, never loaded. */
  restoreMask(group: number, mask: Uint8Array): void {
    const cells = this.cellsWide * this.cellsHigh;
    if (mask.length !== cells) {
      throw new Error(`fog mask for group ${group} holds ${mask.length} bytes, the grid ${cells} cells`);
    }
    const owner = this.visionGroupOf(group);
    if (owner !== group) throw new Error(`fog mask for group ${group}: that player shares group ${owner}`);
    this.masks.set(group, mask);
    const fold = this.foldFor(group);
    if (fold !== null) fold.value = 0;
    for (let r = 0; r < this.cellsHigh; r++) {
      for (let c = 0; c < this.cellsWide; c++) {
        const index = r * this.cellsWide + c;
        const state = mask[index] ?? FOG_STATE.UNEXPLORED;
        if (fold !== null) foldCellChange(fold, index, FOG_STATE.UNEXPLORED, state);
        if (state === FOG_STATE.VISIBLE) this.mergeVisibleBounds(group, c, c, r, r);
      }
    }
  }

  /** Drop every mask (fog switched OFF or the grouping changed): exploration history resets, the
   *  shared-vision table stays, generation bumps once. */
  reset(): void {
    if (this.masks.size === 0) return;
    this.masks.clear();
    this.visibleBounds.clear();
    this.folds?.clear();
    this.generation++;
  }

  /** Merge a stamp's touched cell rect into the may-hold-VISIBLE box of `player`'s group (see
   *  visibleBounds). */
  mergeVisibleBounds(player: number, minC: number, maxC: number, minR: number, maxR: number): void {
    const group = this.visionGroupOf(player);
    const b = this.visibleBounds.get(group);
    if (b === undefined) {
      this.visibleBounds.set(group, { minC, maxC, minR, maxR });
      return;
    }
    if (minC < b.minC) b.minC = minC;
    if (maxC > b.maxC) b.maxC = maxC;
    if (minR < b.minR) b.minR = minR;
    if (maxR > b.maxR) b.maxR = maxR;
  }

  /**
   * Mark every cell with a node within `range` map points of `point` {@link REVEALED_BYTE} for
   * `player`'s group, so a script's reveal shows like ground an own eye covers and outlasts any RECON
   * downgrade. Scans the cells of the clamped box and tests a cell's four nodes only while it is not
   * yet revealed; a range no lattice distance exceeds is the whole grid. The may-hold-VISIBLE box stays
   * untouched: the byte is not VISIBLE, so no downgrade ever needs to find it.
   */
  revealArea(player: number, point: HalfCellNode, range: number): void {
    if (range >= this.cellsWide * 2 + this.cellsHigh * 2) {
      this.revealAll(player);
      return;
    }
    const mask = this.maskFor(player);
    const fold = this.foldFor(player);
    let changed = false;
    const rLo = Math.max(0, (point.hy - range) >> 1);
    const rHi = Math.min(this.cellsHigh - 1, (point.hy + range) >> 1);
    const cLo = Math.max(0, (point.hx - range) >> 1);
    const cHi = Math.min(this.cellsWide - 1, (point.hx + range) >> 1);
    for (let r = rLo; r <= rHi; r++) {
      for (let c = cLo; c <= cHi; c++) {
        const i = r * this.cellsWide + c;
        const previous = mask[i] ?? FOG_STATE.UNEXPLORED;
        if (previous === REVEALED_BYTE || !cellWithinRange(point, range, c, r)) continue;
        mask[i] = REVEALED_BYTE;
        if (fold !== null) foldCellChange(fold, i, previous, REVEALED_BYTE);
        changed = true;
      }
    }
    if (changed) this.generation++;
  }

  /** Mark the whole grid {@link REVEALED_BYTE} for `player`'s group (a script's whole-map `ExploreArea`). */
  revealAll(player: number): void {
    const mask = this.maskFor(player);
    const fold = this.foldFor(player);
    let changed = false;
    for (let i = 0; i < mask.length; i++) {
      const previous = mask[i] ?? FOG_STATE.UNEXPLORED;
      if (previous === REVEALED_BYTE) continue;
      mask[i] = REVEALED_BYTE;
      if (fold !== null) foldCellChange(fold, i, previous, REVEALED_BYTE);
      changed = true;
    }
    if (changed) this.generation++;
  }

  /** Downgrade every VISIBLE byte of vision group `group` to EXPLORED, scanning only the
   *  may-hold-VISIBLE box and then clearing it. Byte-identical to a full-mask scan. */
  downgradeVisible(group: number): void {
    const b = this.visibleBounds.get(group);
    if (b === undefined) return;
    const mask = this.masks.get(group);
    if (mask !== undefined) {
      const fold = this.foldFor(group);
      for (let r = b.minR; r <= b.maxR; r++) {
        const base = r * this.cellsWide;
        for (let c = b.minC; c <= b.maxC; c++) {
          if (mask[base + c] !== FOG_STATE.VISIBLE) continue;
          mask[base + c] = FOG_STATE.EXPLORED;
          if (fold !== null) foldCellChange(fold, base + c, FOG_STATE.VISIBLE, FOG_STATE.EXPLORED);
        }
      }
    }
    this.visibleBounds.delete(group);
  }

  /**
   * Verify the may-hold-VISIBLE boxes against the masks: a VISIBLE byte outside its group's box would
   * silently never downgrade. A `registerCacheVerifier` body, so it runs on checked ticks only, never on
   * the tick path.
   */
  verifyVisibleBounds(): string[] {
    const violations: string[] = [];
    for (const group of this.groupsWithMasks()) {
      const mask = this.masks.get(group);
      if (mask === undefined) continue;
      const b = this.visibleBounds.get(group);
      for (let r = 0; r < this.cellsHigh; r++) {
        for (let c = 0; c < this.cellsWide; c++) {
          if (mask[r * this.cellsWide + c] !== FOG_STATE.VISIBLE) continue;
          if (b === undefined || c < b.minC || c > b.maxC || r < b.minR || r > b.maxR) {
            violations.push(`fog: group ${group} VISIBLE cell (${c}, ${r}) outside its bounds box`);
          }
        }
      }
    }
    return violations;
  }

  /**
   * Mix this state's canonical bytes into a hash: the shared-vision table, then per vision group
   * ascending the group id and its raw mask bytes. A world that never enabled fog nor shared vision
   * holds neither and contributes nothing, so every pre-fog hash stays byte-identical.
   */
  hashInto(mix: (n: number) => void): void {
    this.hashGroupsInto(mix);
    for (const group of this.groupsWithMasks()) {
      mix(group);
      const mask = this.masks.get(group);
      if (mask === undefined) continue; // unreachable - groupsWithMasks lists only allocated masks
      for (let i = 0; i < mask.length; i++) mix(mask[i] ?? 0);
    }
  }

  /** The shared-vision table's canonical bytes: each (player, group) pair ascending by player. */
  private hashGroupsInto(mix: (n: number) => void): void {
    for (const [player, group] of this.groupOf) {
      mix(player);
      mix(group);
    }
  }

  /** The raw {@link FOG_STATE} of a cell for `player`'s group, a revealed cell reading VISIBLE; out of
   *  grid or maskless reads UNEXPLORED. RECON's terrain-known-from-the-start is a view mapping in
   *  `effectiveFogState`, not raw state. */
  stateAt(player: number, cellX: number, cellY: number): number {
    if (cellX < 0 || cellY < 0 || cellX >= this.cellsWide || cellY >= this.cellsHigh) {
      return FOG_STATE.UNEXPLORED;
    }
    const mask = this.masks.get(this.visionGroupOf(player));
    if (mask === undefined) return FOG_STATE.UNEXPLORED;
    const byte = mask[cellY * this.cellsWide + cellX] ?? FOG_STATE.UNEXPLORED;
    return byte === REVEALED_BYTE ? FOG_STATE.VISIBLE : byte;
  }
}

/** Whether any of cell (c, r)'s four nodes lies within `range` map points of `point`. */
function cellWithinRange(point: HalfCellNode, range: number, c: number, r: number): boolean {
  const hx = c * 2;
  const hy = r * 2;
  return (
    hexDistanceBetween(point.hx, point.hy, hx, hy) <= range ||
    hexDistanceBetween(point.hx, point.hy, hx + 1, hy) <= range ||
    hexDistanceBetween(point.hx, point.hy, hx, hy + 1) <= range ||
    hexDistanceBetween(point.hx, point.hy, hx + 1, hy + 1) <= range
  );
}
