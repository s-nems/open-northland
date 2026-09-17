import { FOG_STATE, type FogView, fogSettings, type WorldSnapshot } from '@open-northland/sim';
import { ONE } from '../projection/index.js';
import type { DrawKind, EntityKind, StaticDrawFields } from '../scene/draw-item.js';
import { assignPalisadeFields, palisadeLayoutOf } from '../scene/palisade-connections.js';
import { assignStaticFields, classify, readPosition } from '../scene/snapshot-readers/index.js';
import type { ElevationField } from '../terrain/index.js';
import { fogCellOfTile } from './mask.js';

/**
 * The viewer's remembered statics: a building, wall, resource node, stump, chest, goods heap or vehicle
 * that was once seen keeps drawing on explored ground, frozen at its last-seen state until the player
 * re-sees the cell (a vehicle stays where it was last seen, like a building). Render-side and per local
 * viewer only - the sim reads its own masks, so determinism is untouched. Authored approximation: the
 * original never un-sees ground (the classic map without fog of war), so it has no ghosts.
 */

type FogGhostKind = Extract<
  DrawKind,
  'building' | 'palisade' | 'resource' | 'stump' | 'chest' | 'stockpile' | 'vehicle'
>;

/** One remembered static, frozen at its last sighting. Tile coords are floats in tile units. */
export type FogGhost = Readonly<StaticDrawFields> & {
  readonly ref: number;
  readonly kind: FogGhostKind;
  readonly tileX: number;
  readonly tileY: number;
  /** Screen px a staggered palisade draws beside its node. */
  readonly shiftX?: number;
};

function isGhostKind(kind: EntityKind | null): kind is FogGhostKind {
  return (
    kind === 'building' ||
    kind === 'palisade' ||
    kind === 'resource' ||
    kind === 'stump' ||
    kind === 'chest' ||
    kind === 'stockpile' ||
    kind === 'vehicle'
  );
}

/** A `stockpile` memory is a heap of goods; a delivery flag or an emptied pile names no good and is
 *  no static to remember. A wall keeps its posts and stagger as the snapshot's layout draws them. */
function capture(
  snapshot: WorldSnapshot,
  elevation: ElevationField | undefined,
  id: number,
  kind: FogGhostKind,
  components: Readonly<Record<string, unknown>>,
): FogGhost | null {
  const pos = readPosition(components);
  if (pos === null) return null;
  const ghost: {
    -readonly [K in keyof FogGhost]: FogGhost[K];
  } = { ref: id, kind, tileX: pos.x / ONE, tileY: pos.y / ONE };
  if (kind === 'palisade') {
    const shiftX = assignPalisadeFields(ghost, id, components, palisadeLayoutOf(snapshot, elevation));
    if (shiftX !== 0) ghost.shiftX = shiftX;
  } else assignStaticFields(ghost, kind, components);
  if (kind === 'stockpile' && ghost.goodType === undefined) return null;
  return ghost;
}

export class FogGhostStore {
  private readonly records = new Map<number, FogGhost>();
  /** The drawable subset, rebuilt per mask generation and returned by reference. */
  private drawList: FogGhost[] = [];
  private lastGeneration = -1;
  private lastPlayer: number | null = null;
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

  /** Forget the memory and the cache key with it, so the next update rebuilds even from an empty
   *  store: a seat switch under one generation must still capture what the new seat sees. */
  clear(): void {
    this.lastGeneration = -1;
    this.lastPlayer = null;
    this.lastMode = -1;
    this.reconSeeded = false;
    if (this.records.size === 0 && this.drawList.length === 0) return;
    this.records.clear();
    this.drawList = [];
  }

  /**
   * Update the memory and return the drawable ghosts, cached by (generation, player, mode) so a
   * frame with no mask rebuild is a field read. Refs in `staticRefs` never ghost - the retained
   * map-object layer already draws their last-seen state. The memory is one seat's: a spectator
   * switching seats starts the new seat's from what it sees now, since what that seat saw before the
   * switch was never recorded here (approximation of the original's per-player memory). `elevation` is
   * the scene's, so a remembered wall's posts follow the slope its live draw did.
   */
  update(
    snapshot: WorldSnapshot,
    view: FogView,
    staticRefs?: ReadonlySet<number>,
    elevation?: ElevationField,
  ): readonly FogGhost[] {
    if (view.player !== this.lastPlayer) this.clear();
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
    // stands, as the known-terrain view shows the map's placed objects; buildings, walls and vehicles stay intel
    // the player has to see for himself.
    for (const entity of snapshot.entities) {
      if (staticRefs?.has(entity.id)) continue;
      const kind = classify(entity.components);
      if (!isGhostKind(kind)) continue;
      const adopted = this.pendingAdopt.has(entity.id);
      const seeded = seedResources && kind !== 'building' && kind !== 'palisade' && kind !== 'vehicle';
      let sighted = false;
      if (!adopted && !seeded) {
        const pos = readPosition(entity.components);
        if (pos === null) continue;
        const { cx, cy } = fogCellOfTile(pos.x / ONE, pos.y / ONE);
        sighted = view.stateAt(cx, cy) === FOG_STATE.VISIBLE;
      }
      if (!adopted && !seeded && !sighted) continue;
      const ghost = capture(snapshot, elevation, entity.id, kind, entity.components);
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
    this.lastPlayer = view.player;
    this.lastMode = view.mode;
    return this.drawList;
  }
}
