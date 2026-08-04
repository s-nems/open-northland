import { type EntitySnapshot, entityById, type WorldSnapshot } from '@open-northland/sim';
import type { FogGhost } from '../fog/index.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../projection/index.js';
import { type ElevationField, terrainLiftAt } from '../terrain/index.js';
import {
  assignBerryBushFields,
  assignBuildingFields,
  assignProjectileArc,
  assignSettlerFields,
  assignStockpileFields,
  pushGhostItems,
  pushSignpostItems,
} from './collect-fields.js';
import { spriteDepth } from './depth.js';
import type { MutableSpriteDrawItem, SpriteDrawItem, SpriteState } from './draw-item.js';
import { isIndoorSettler, TARGET_FACING_ATOMIC_IDS, targetPositionsOf } from './snapshot-index.js';
import {
  assignStaticFields,
  classify,
  facingTowardTile,
  readActingAtomic,
  readAtomicTargetEntity,
  readPosition,
  readSpriteState,
} from './snapshot-readers/index.js';
import type { SpriteSpatialIndex } from './spatial-index.js';

/** Whether a ref is alive (drawable) this frame. A `ReadonlySet` satisfies it; the index-backed build
 *  serves it without materializing the map-wide set, which is why it is not a set type. */
export interface LiveRefs {
  has(ref: number): boolean;
}

export interface SpriteScene {
  readonly items: SpriteDrawItem[];
  /** Membership over every drawable entity before the cull: a ref answering false has died, one
   *  answering true but absent from {@link items} is merely off-screen. Valid for this build's frame
   *  only, since the index-backed view reads shared mutable state. */
  readonly liveRefs: LiveRefs;
}

/** Every field accepts an explicit `undefined` so callers can pass through their own optionals. */
export interface SpriteSceneOptions {
  /** The (margin-inflated) world-space camera box - cull to it; absent = emit every sprite. */
  readonly viewport?: Viewport | undefined;
  /** The map's terrain-height field; absent/flat = no lift. */
  readonly elevation?: ElevationField | undefined;
  /** Entities the retained static map-object layer draws instead (a decoded map's virgin resource nodes) -
   *  skipped entirely: no draw item, excluded from {@link SpriteScene.liveRefs}. */
  readonly staticRefs?: ReadonlySet<number> | undefined;
  /**
   * The caller's retained {@link SpriteSpatialIndex}: with a `viewport`, the build walks only its
   * buckets under the camera instead of every snapshot entity, and {@link SpriteScene.liveRefs} becomes
   * a membership view over the index. The build updates the index to this snapshot itself. Ignored
   * without a `viewport` or with `onlyRefs`.
   */
  readonly index?: SpriteSpatialIndex | undefined;
  /** The fog-of-war cull; absent = no fog. An entity whose tile it rejects is treated like a
   *  viewport-culled one: no draw item, but kept live so its pooled sprite survives until the fog
   *  lifts. */
  readonly fogVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  /** The viewer's remembered statics, drawn dimmed on explored ground and joined to
   *  {@link SpriteScene.liveRefs}. A ref never yields two items: the store deletes records on visible
   *  ground, and the fog cull drops live items elsewhere. */
  readonly ghosts?: readonly FogGhost[] | undefined;
  /**
   * Keep settlers that are inside a building, forced to the `idle` standing pose. The map hides these
   * (observed original: off-duty workers wait in the house, not lined up at the door). Approximation:
   * the observation covers hiding the settler on the map; how the original's building window presents
   * one indoors is unverified.
   */
  readonly keepIndoorSettlers?: boolean;
  /**
   * The details-panel portrait's subject: this one entity is emitted even when the viewport/fog cull or
   * the indoor-settler suppression would drop it, so its live cutout never blanks. Absent = no portrait
   * open.
   */
  readonly portraitRef?: number | undefined;
  /** Owner slot → team-colour slot, when a map's roster recolours players away from the slot-id
   *  default. Absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
}

/**
 * `onlyRefs` also keeps unlisted entities out of {@link SpriteScene.liveRefs}, which is why it lives
 * here rather than on {@link SpriteSceneOptions}: {@link buildSpriteScene} discards that view, while
 * the retained pool's reconcile would read a narrowed set as "everything else died" and destroy the
 * map's sprites.
 */
export interface DrawListOptions extends SpriteSceneOptions {
  /**
   * Emit draw items for these entities only; absent = every entity. Every pre-scan still reads the
   * whole snapshot, so indoor state and target-derived facing resolve exactly as on the map - a caller
   * narrowing the snapshot instead would starve those pre-scans.
   */
  readonly onlyRefs?: ReadonlySet<number> | undefined;
}

/** The depth-sorted sprite draw list alone, without terrain. An item is kept iff its screen anchor is
 *  inside the already margin-inflated `viewport` box. */
export function buildSpriteScene(snapshot: WorldSnapshot, opts: DrawListOptions = {}): SpriteDrawItem[] {
  return collectScene(snapshot, opts).items;
}

/**
 * Build the draw list and the pre-cull liveness view in one pass, so a caller needing both does not
 * classify every entity twice per frame. The per-kind reads run only for items that survive the cull.
 * The emitted order is total and stable, so neither culling nor the entity source (full walk or the
 * index's arbitrary bucket order) changes the list.
 */
export function collectSpriteScene(snapshot: WorldSnapshot, opts: SpriteSceneOptions = {}): SpriteScene {
  return collectScene(snapshot, opts);
}

function collectScene(snapshot: WorldSnapshot, opts: DrawListOptions): SpriteScene {
  const {
    viewport,
    elevation,
    staticRefs,
    index,
    onlyRefs,
    fogVisible,
    ghosts,
    keepIndoorSettlers,
    portraitRef,
    playerColourOf,
  } = opts;
  const items: MutableSpriteDrawItem[] = [];
  // Refs collected while emitting; in the walk modes this is the whole liveness set.
  const collected = new Set<number>();
  const posByRef = targetPositionsOf(snapshot);

  const emit = (entity: EntitySnapshot): void => {
    // Drawn by the retained static layer instead - skip before paying for a classify.
    if (staticRefs?.has(entity.id)) return;
    const components = entity.components;
    const kind = classify(components);
    if (kind === null) return;
    const pos = readPosition(components);
    if (pos === null) return;
    const isPortrait = portraitRef !== undefined && entity.id === portraitRef;
    // An indoor settler stays live and pooled but draws nothing, unless kept or forced below.
    let indoorSettler = false;
    if (kind === 'settler') {
      indoorSettler = isIndoorSettler(snapshot, components);
      if (indoorSettler && keepIndoorSettlers !== true && !isPortrait) {
        collected.add(entity.id);
        return;
      }
    }
    // Read here, not in the stockpile branch below, so it folds into the depth key.
    const isFlag = 'DeliveryFlag' in components;
    collected.add(entity.id);
    const tileX = pos.x / ONE;
    const tileY = pos.y / ONE;
    const screen = tileToScreen(tileX, tileY);
    // An indoor settler is forced idle, so a path or atomic left running from the tick it stepped
    // inside can't leave it walking or mid-swing in the panel's portrait.
    const state: SpriteState = kind === 'settler' && !indoorSettler ? readSpriteState(components) : 'idle';
    const actingAtomic = kind === 'settler' && !indoorSettler ? readActingAtomic(components) : null;
    // A mid-swing settler only turns; the drawn anchor never moves toward its target. The swing frames
    // carry their own advance in the per-frame foot offsets, so a positional nudge would double it.
    let targetFacing: number | undefined;
    if (kind === 'settler' && actingAtomic !== null && TARGET_FACING_ATOMIC_IDS.has(actingAtomic)) {
      const targetRef = readAtomicTargetEntity(components);
      const to = targetRef !== null ? posByRef.get(targetRef) : undefined;
      if (to !== undefined) {
        targetFacing = facingTowardTile({ x: tileX, y: tileY }, { x: to.x / ONE, y: to.y / ONE });
      }
    }
    const drawX = screen.x;
    const drawY = screen.y;
    // Culls on the drawn anchor; the caller pre-inflates the box to cover a tall sprite's extent, so a
    // building straddling the edge still draws.
    const offscreen = viewport !== undefined && !isVisible(viewport, drawX, drawY);
    if (offscreen && !isPortrait) return;
    // After the viewport cull on purpose: the fog probe costs a mask lookup per call, so it runs for
    // the few on-screen entities, not the map.
    const fogged = fogVisible !== undefined && !fogVisible(tileX, tileY);
    if (fogged && !isPortrait) return;
    const lift = terrainLiftAt(elevation, tileX, tileY);
    // A projectile's ballistic height rides the same lift channel as terrain lift: a draw offset the
    // depth key never sees, so neither can reshuffle occlusion.
    let arcLift = 0;
    const item: MutableSpriteDrawItem = {
      kind,
      ref: entity.id,
      x: drawX,
      y: drawY,
      depth: spriteDepth(tileX, tileY, kind, isFlag),
      state,
    };
    switch (kind) {
      case 'settler':
        assignSettlerFields(item, components, actingAtomic, targetFacing);
        break;
      case 'building':
        assignBuildingFields(item, components);
        break;
      case 'resource':
      case 'stump':
        assignStaticFields(item, kind, components);
        break;
      case 'berrybush':
        assignBerryBushFields(item, components);
        break;
      case 'signpost':
        pushSignpostItems(items, collected, snapshot, item, components, tileX, tileY, lift, playerColourOf);
        break;
      case 'projectile':
        arcLift = assignProjectileArc(item, components, screen, posByRef);
        break;
      case 'stockpile':
      case 'grounddrop':
        assignStockpileFields(item, components, isFlag);
        break;
      default: {
        const _exhaustive: never = kind;
        void _exhaustive;
      }
    }
    const drawLift = lift + arcLift;
    if (drawLift !== 0) item.lift = drawLift;
    if (isPortrait && (offscreen || fogged || indoorSettler)) item.portraitOnly = true;
    // Only a kept or forced settler gets this far indoors, and both draw a motionless standing pose.
    if (indoorSettler) item.frozen = true;
    if (playerColourOf !== undefined && item.player !== undefined) {
      item.player = playerColourOf(item.player);
    }
    items.push(item);
  };

  // The index mode never walks the map, so its liveness answer is a view over `collected` (probed
  // live, which covers the ghost refs pushed below) plus the index's drawables minus the static ones.
  let liveRefs: LiveRefs = collected;
  if (index !== undefined && viewport !== undefined && onlyRefs === undefined) {
    // Each bucket candidate still runs the exact per-item cull above, so the emitted set matches the
    // full walk's.
    index.update(snapshot);
    for (const entity of index.query(viewport)) emit(entity);
    // The portrait subject may sit outside the queried buckets.
    if (portraitRef !== undefined && !collected.has(portraitRef)) {
      const subject = entityById(snapshot, portraitRef);
      if (subject !== undefined) emit(subject);
    }
    liveRefs = { has: (ref) => collected.has(ref) || (index.has(ref) && staticRefs?.has(ref) !== true) };
  } else if (onlyRefs !== undefined) {
    // Binary search per ref, instead of walking a decoded map's tens of thousands of entities.
    for (const ref of onlyRefs) {
      const entity = entityById(snapshot, ref);
      if (entity !== undefined) emit(entity);
    }
  } else {
    for (const entity of snapshot.entities) emit(entity);
  }

  if (ghosts !== undefined) pushGhostItems(items, collected, ghosts, viewport, elevation);
  // `depth` carries the feet anchor plus the per-kind paint bias; id breaks a remaining exact tie.
  items.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return { items, liveRefs };
}
