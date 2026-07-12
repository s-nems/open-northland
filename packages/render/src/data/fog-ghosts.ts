import { FOG_MODE, FOG_STATE, type FogView, type WorldSnapshot } from '@vinland/sim';
import { fogCellOfTile } from './fog.js';
import { ONE } from './iso.js';
import type { DrawKind } from './scene/draw-item.js';
import {
  classify,
  readBuildingType,
  readBuiltPct,
  readPosition,
  readResourceGfxIndex,
  readResourceGood,
  readResourceLevel,
  readStumpGood,
} from './scene/snapshot-readers.js';

/**
 * FOG GHOSTS — the viewer player's remembered STATICS: a building, resource node or stump, once seen,
 * keeps drawing (dimmed to the explored-grey grading) after its ground falls back under the fog — the
 * classic RTS "last known intel" layer. All design here is OURS (the original's reveal mode never
 * un-sees ground, so it has no ghosts to observe); the rules follow the genre convention the user
 * asked for (2026-07-12):
 *
 *  - Only STATICS ghost (building / resource / stump). Units, piles and flags vanish with the fog —
 *    they move or churn, so a remembered copy would be a lie within seconds.
 *  - A ghost is the LAST-SEEN state, frozen: a building destroyed (or a tree felled) behind the fog
 *    keeps its ghost until the player actually re-sees the cell — then the record refreshes to the
 *    live state or disappears with its entity. That "stale on purpose" is the feature, not a bug.
 *  - RECON additionally seeds every NATURAL resource (resource/stump kinds, never buildings) at the
 *    moment the mode takes effect — "terrain rozpoznany" includes where the trees and rocks are (the
 *    Age-of-Empires explored-map convention), but not what anyone has built.
 *
 * The store is render-side, per LOCAL viewer only — the sim's combat gates read the true masks and
 * never this memory, so determinism is untouched. Rebuilds ride {@link FogView.generation} (the
 * VisionSystem cadence, a few times a second): one pass over the snapshot's entities per rebuild,
 * O(pool-drawn statics), never per frame (golden rule 6). Entities in `staticRefs` (a decoded map's
 * virgin nodes) are skipped — the retained map-object layer IS their ghost (they cannot change until
 * first worked, so drawing the real object on explored ground is exactly the last-seen state).
 */

/** The DrawItem kinds that ghost — statics whose last-seen state stays meaningful under fog. */
type FogGhostKind = Extract<DrawKind, 'building' | 'resource' | 'stump'>;

/** One remembered static: the entity's identity + the per-kind reads its draw needs, frozen at the
 *  last VISIBLE sighting. Tile coords are floats (fixed → tile, render-only). */
export interface FogGhost {
  readonly ref: number;
  readonly kind: FogGhostKind;
  readonly tileX: number;
  readonly tileY: number;
  readonly typeId?: number;
  readonly builtPct?: number;
  readonly goodType?: number;
  readonly level?: number;
  readonly gfxIndex?: number;
}

/** Whether a classified snapshot entity is a ghosting static. */
function isGhostKind(kind: DrawKind | null): kind is FogGhostKind {
  return kind === 'building' || kind === 'resource' || kind === 'stump';
}

/** Capture one snapshot entity as a ghost record, or null when it has no position. */
function capture(
  id: number,
  kind: FogGhostKind,
  components: Readonly<Record<string, unknown>>,
): FogGhost | null {
  const pos = readPosition(components);
  if (pos === null) return null;
  const ghost: {
    -readonly [K in keyof FogGhost]: FogGhost[K];
  } = { ref: id, kind, tileX: pos.x / ONE, tileY: pos.y / ONE };
  if (kind === 'building') {
    const typeId = readBuildingType(components);
    if (typeId !== undefined) ghost.typeId = typeId;
    const builtPct = readBuiltPct(components);
    if (builtPct !== undefined) ghost.builtPct = builtPct;
  } else if (kind === 'resource') {
    const goodType = readResourceGood(components);
    if (goodType !== undefined) ghost.goodType = goodType;
    const level = readResourceLevel(components);
    if (level !== undefined) ghost.level = level;
    const gfxIndex = readResourceGfxIndex(components);
    if (gfxIndex !== undefined) ghost.gfxIndex = gfxIndex;
  } else {
    const goodType = readStumpGood(components);
    if (goodType !== undefined) ghost.goodType = goodType;
  }
  return ghost;
}

export class FogGhostStore {
  /** ref → last-seen record. A record exists only for cells the viewer does NOT currently see —
   *  every rebuild deletes records on VISIBLE ground first, then re-captures what is live there. */
  private readonly records = new Map<number, FogGhost>();
  /** The drawable subset of {@link records} (cells at least EXPLORED under the current view),
   *  rebuilt per mask generation and returned by reference — the per-frame path never rescans. */
  private drawList: FogGhost[] = [];
  /** The (generation, mode) the store last rebuilt for — the skip key. */
  private lastGeneration = -1;
  private lastMode = -1;
  /** Whether the current RECON stretch already seeded the natural resources (re-arms on leaving). */
  private reconSeeded = false;
  /** Refs to capture on the next rebuild REGARDLESS of visibility — the decoded-map handover seam:
   *  a virgin node first worked under fog leaves the static layer, and without this its last-seen
   *  (virgin) look would simply vanish from explored ground. Survives fog-off (adoption may precede
   *  the mode change that makes it matter). */
  private readonly pendingAdopt = new Set<number>();

  /** Remember `ref` for capture on the next rebuild even if its cell is not visible (see pendingAdopt). */
  adopt(ref: number): void {
    this.pendingAdopt.add(ref);
  }

  /** Drop every memory (fog switched OFF — the sim resets exploration history the same way). */
  clear(): void {
    if (this.records.size === 0 && this.drawList.length === 0 && !this.reconSeeded) return;
    this.records.clear();
    this.drawList = [];
    this.lastGeneration = -1;
    this.lastMode = -1;
    this.reconSeeded = false;
  }

  /**
   * Bring the memory up to date with one mask rebuild and return the drawable ghosts — cached by
   * (generation, mode), so per FRAME this is a field read; the passes below run only when the sim's
   * VisionSystem actually rebuilt the masks (or an adoption is pending).
   */
  update(snapshot: WorldSnapshot, view: FogView, staticRefs?: ReadonlySet<number>): readonly FogGhost[] {
    if (
      view.generation === this.lastGeneration &&
      view.mode === this.lastMode &&
      this.pendingAdopt.size === 0
    ) {
      return this.drawList;
    }
    if (view.mode !== FOG_MODE.RECON) this.reconSeeded = false;
    const seedResources = view.mode === FOG_MODE.RECON && !this.reconSeeded;

    // Pass 1 — forget everything on ground the viewer SEES: what is really there draws live, and a
    // dead static must not leave a ghost on watched ground. Pass 2 re-captures the live statics.
    for (const [ref, ghost] of this.records) {
      const { cx, cy } = fogCellOfTile(ghost.tileX, ghost.tileY);
      if (view.stateAt(cx, cy) === FOG_STATE.VISIBLE) this.records.delete(ref);
    }

    // Pass 2 — capture: every pool-drawn static on VISIBLE ground (the normal sighting), every
    // pending adoption (visibility waived — the handover seam), and, when RECON just took effect,
    // every natural resource anywhere (the "terrain known" seed; buildings stay intel).
    for (const entity of snapshot.entities) {
      if (staticRefs?.has(entity.id)) continue;
      const kind = classify(entity.components);
      if (!isGhostKind(kind)) continue;
      const adopted = this.pendingAdopt.has(entity.id);
      const seeded = seedResources && kind !== 'building';
      let sighted = false;
      if (!adopted && !seeded) {
        const pos = readPosition(entity.components);
        if (pos === null) continue;
        const { cx, cy } = fogCellOfTile(pos.x / ONE, pos.y / ONE);
        sighted = view.stateAt(cx, cy) === FOG_STATE.VISIBLE;
      }
      if (!adopted && !seeded && !sighted) continue;
      const ghost = capture(entity.id, kind, entity.components);
      if (ghost !== null) this.records.set(entity.id, ghost);
    }
    this.pendingAdopt.clear();
    if (seedResources) this.reconSeeded = true;

    // Drawable subset: a ghost draws ONLY on EXPLORED ground. On VISIBLE ground the live entity
    // draws instead (a freshly-SEEDED record can sit there — emitting it too would double-draw the
    // ref); on UNEXPLORED ground the memory stays but must not draw into the black (reachable across
    // a mode switch — RECON's seeded knowledge read through FULL's raw mask).
    const drawable: FogGhost[] = [];
    for (const ghost of this.records.values()) {
      const { cx, cy } = fogCellOfTile(ghost.tileX, ghost.tileY);
      if (view.stateAt(cx, cy) === FOG_STATE.EXPLORED) drawable.push(ghost);
    }
    this.drawList = drawable;
    this.lastGeneration = view.generation;
    this.lastMode = view.mode;
    return this.drawList;
  }
}
