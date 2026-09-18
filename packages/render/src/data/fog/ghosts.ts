import { FOG_STATE, type FogView, fogSettings, type WorldSnapshot } from '@open-northland/sim';
import { ONE } from '../projection/index.js';
import type { DrawKind, EntityKind, StaticDrawFields } from '../scene/draw-item.js';
import { assignStaticFields, classify, readPosition } from '../scene/snapshot-readers/index.js';
import { fogCellOfTile } from './mask.js';

/**
 * The viewer's remembered statics: a building, resource node, stump, chest or goods heap that was once
 * seen keeps drawing on explored ground, frozen at its last-seen state until the player re-sees the
 * cell. Render-side and per local viewer only - the sim reads its own masks, so determinism is
 * untouched. Authored approximation: the original never un-sees ground (the classic map without fog
 * of war), so it has no ghosts.
 */

type FogGhostKind = Extract<DrawKind, 'building' | 'resource' | 'stump' | 'chest' | 'stockpile'>;

/** One remembered static, frozen at its last sighting. Tile coords are floats in tile units. */
export type FogGhost = Readonly<StaticDrawFields> & {
  readonly ref: number;
  readonly kind: FogGhostKind;
  readonly tileX: number;
  readonly tileY: number;
};

function isGhostKind(kind: EntityKind | null): kind is FogGhostKind {
  return (
    kind === 'building' || kind === 'resource' || kind === 'stump' || kind === 'chest' || kind === 'stockpile'
  );
}

/** A `stockpile` memory is a heap of goods; a delivery flag or an emptied pile names no good and is
 *  no static to remember. */
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
  assignStaticFields(ghost, kind, components);
  if (kind === 'stockpile' && ghost.goodType === undefined) return null;
  return ghost;
}

export class FogGhostStore {
  private readonly records = new Map<number, FogGhost>();
  /** The drawable subset, rebuilt per mask generation and returned by reference. */
  private drawList: FogGhost[] = [];
  private lastGeneration = -1;
  private lastMode = -1;
  /** Whether the current known-terrain stretch already seeded natural resources. */
  private reconSeeded = false;
  /** Refs to capture on the next rebuild whatever their visibility: a virgin map node first worked
   *  under fog leaves the static layer, and its last-seen look must not vanish from explored ground.
   *  Deliberately outlives `clear` - an adoption can precede the mode change that needs it. */
  private readonly pendingAdopt = new Set<number>();

  adopt(ref: number): void {
    this.pendingAdopt.add(ref);
  }

  clear(): void {
    if (this.records.size === 0 && this.drawList.length === 0 && !this.reconSeeded) return;
    this.records.clear();
    this.drawList = [];
    this.lastGeneration = -1;
    this.lastMode = -1;
    this.reconSeeded = false;
  }

  /**
   * Update the memory and return the drawable ghosts, cached by (generation, mode) so a frame with
   * no mask rebuild is a field read. Refs in `staticRefs` never ghost - the retained map-object
   * layer already draws their last-seen state.
   */
  update(snapshot: WorldSnapshot, view: FogView, staticRefs?: ReadonlySet<number>): readonly FogGhost[] {
    if (
      view.generation === this.lastGeneration &&
      view.mode === this.lastMode &&
      this.pendingAdopt.size === 0
    ) {
      return this.drawList;
    }
    const terrainKnown = fogSettings(view.mode)?.terrainKnown === true;
    if (!terrainKnown) this.reconSeeded = false;
    const seedResources = terrainKnown && !this.reconSeeded;

    // Forget ground the viewer sees: a dead static must not leave a ghost on watched ground.
    for (const [ref, ghost] of this.records) {
      const { cx, cy } = fogCellOfTile(ghost.tileX, ghost.tileY);
      if (view.stateAt(cx, cy) === FOG_STATE.VISIBLE) this.records.delete(ref);
    }

    // Taking effect, a RECON map seeds every natural resource, map chest and goods heap wherever it
    // stands, as the known-terrain view shows the map's placed objects; buildings stay intel the player
    // has to see for himself.
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

    // Explored ground only: a visible cell draws the live entity instead (a seeded record there
    // would double-draw the ref), and a memory under an unexplored cell must stay in the black.
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
