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
import type { DrawItem, MutableDrawItem, SpriteState } from './draw-item.js';
import { enterableStoresOf, TARGET_FACING_ATOMIC_IDS, targetPositionsOf } from './snapshot-index.js';
import {
  assignStaticFields,
  classify,
  facingTowardTile,
  readActingAtomic,
  readAtomicTargetEntity,
  readPosition,
  readSpriteState,
  readStoreExchangeRef,
} from './snapshot-readers/index.js';
import type { SpriteSpatialIndex } from './spatial-index.js';

/**
 * The sprite-scene builder: turns a {@link WorldSnapshot} into a flat, depth-sorted list of sprite
 * draw items in isometric screen space (plain data, no Pixi), plus the pre-cull liveness view the retained
 * pool reconciles against. This module owns the projection, the cull, and the depth order; the component
 * reads live in {@link import('./snapshot-readers/index.js')}, the per-snapshot pre-scan memos in
 * {@link import('./snapshot-index.js')}, the retained viewport index in {@link import('./spatial-index.js')},
 * and the per-kind item tagging in {@link import('./collect-fields.js')}.
 *
 * Floats are fine here: `render` is a pure consumer of sim state (docs/ARCHITECTURE.md). The snapshot's
 * `Fixed` position (a scaled integer) is divided by ONE to a float tile coordinate; nothing feeds back
 * into the sim.
 */

/** The membership face of {@link SpriteScene.liveRefs}: "is this ref alive (drawable) this frame?".
 *  A `ReadonlySet` satisfies it; the index-backed build serves it without materializing the map-wide
 *  set, which is why it is not a set type. */
export interface LiveRefs {
  has(ref: number): boolean;
}

/** One frame's sprite scene: the culled, depth-sorted draw list plus the pre-cull liveness view,
 *  produced in one pass over the snapshot — or over the spatial index's viewport buckets when the
 *  caller retains one (see {@link collectSpriteScene}). */
export interface SpriteScene {
  readonly items: DrawItem[];
  /** Membership over every drawable entity before the cull — the view the retained pool reconciles
   *  against (a ref answering false has died; one answering true but not in {@link items} is merely
   *  off-screen). Valid for this build's frame only: the index-backed view reads shared mutable state
   *  (the spatial index's generation, the caller's `staticRefs`). */
  readonly liveRefs: LiveRefs;
}

/** The optional inputs of a scene build. Every field accepts an explicit `undefined` so callers can
 *  pass through their own optionals directly. */
export interface SpriteSceneOptions {
  /** The (margin-inflated) world-space camera box — cull to it; absent = emit every sprite. */
  readonly viewport?: Viewport | undefined;
  /** The map's terrain-height field; absent/flat = no lift. */
  readonly elevation?: ElevationField | undefined;
  /** Entities the retained static map-object layer draws instead (a decoded map's virgin resource nodes) —
   *  skipped entirely: no draw item, excluded from {@link SpriteScene.liveRefs}. */
  readonly staticRefs?: ReadonlySet<number> | undefined;
  /**
   * The caller's retained {@link SpriteSpatialIndex}: with a `viewport`, the build walks only the index's
   * buckets under it instead of every snapshot entity, and {@link SpriteScene.liveRefs} becomes a
   * membership view over the index (never a materialized map-wide set). The build updates the index to
   * this snapshot itself, so a caller only holds the instance. Ignored without a `viewport` or with
   * `onlyRefs`.
   */
  readonly index?: SpriteSpatialIndex | undefined;
  /** The fog-of-war cull (`data/fog/mask.ts` over the viewer's `FogView`); absent = no fog. An entity whose tile
   *  it rejects is treated like a viewport-culled one — no draw item, but kept live so its pooled sprite
   *  survives until the fog lifts. */
  readonly fogVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  /** The viewer's remembered statics (`data/fog/ghosts.ts`, pre-filtered to explored ground by the store),
   *  drawn dimmed on explored ground. Each projects like a live static (same anchor, lift and depth formula,
   *  so it occludes correctly against live sprites at the fog boundary) and joins {@link SpriteScene.liveRefs},
   *  keeping a dead entity's pooled sprite alive for as long as the memory draws. A ref never yields two
   *  items: the store deletes records on visible ground, and the fog cull drops live items elsewhere. */
  readonly ghosts?: readonly FogGhost[] | undefined;
  /**
   * Keep settlers that are inside a building — mid-exchange in a completed store, or waiting in their
   * workplace between chores (the sim `Resting` marker) — forced to the `idle` standing pose. The map
   * hides these (observed original: off-duty workers wait in the house, not lined up at the door); the
   * details panel's worker field sets this so a bound worker who stepped inside still shows there.
   * Each kept settler is tagged {@link DrawItem.frozen}. Approximation: the observation covers hiding
   * the settler on the MAP; how the original's building window presents one indoors is unverified.
   */
  readonly keepIndoorSettlers?: boolean;
  /**
   * The details-panel portrait's subject: this one entity is emitted even when the viewport/fog cull or
   * the indoor-settler suppression would drop it, so its live cutout never blanks when the settler walks
   * off-screen or steps inside its workplace. A forced item is tagged {@link DrawItem.portraitOnly} (the
   * pool hides it on the main map) and, when it is an indoor settler, {@link DrawItem.frozen} (a
   * motionless standing pose). Absent = no portrait open.
   */
  readonly portraitRef?: number | undefined;
  /**
   * Owner slot → team-colour slot, when a map's roster recolours players away from the slot-id
   * default. Applied to every emitted {@link DrawItem.player} (settler LUT rows, the signpost's
   * per-colour baked atlas). Absent = identity (player id is the colour slot).
   */
  readonly playerColourOf?: ((player: number) => number) | undefined;
}

/**
 * The extra input only the draw-list entry point accepts. `onlyRefs` resolves each listed ref by
 * `entityById` instead of walking the snapshot, which also keeps unlisted entities out of
 * {@link SpriteScene.liveRefs} — safe here because {@link buildSpriteScene} discards that view, and
 * unavailable to {@link collectSpriteScene} (the retained pool's reconcile) which would read a narrowed
 * set as "everything else died" and destroy the map's sprites.
 */
export interface DrawListOptions extends SpriteSceneOptions {
  /**
   * Emit draw items for these entities only. Every pre-scan still reads the whole snapshot, so indoor
   * state and target-derived facing resolve exactly as on the map; that is why a caller wanting a few
   * known entities passes this instead of a snapshot narrowed to them, which starves those pre-scans.
   * Absent = every entity.
   */
  readonly onlyRefs?: ReadonlySet<number> | undefined;
}

/**
 * The depth-sorted sprite draw list alone (no terrain) — the per-frame half the retained
 * {@link import('../../gpu/world-renderer/index.js').WorldRenderer} consumes. Terrain is static and built once
 * (`setTerrain`), so only moving/animated entities flow through here. An item is kept iff its screen anchor
 * is inside the already margin-inflated `viewport` box.
 */
export function buildSpriteScene(snapshot: WorldSnapshot, opts: DrawListOptions = {}): DrawItem[] {
  return collectScene(snapshot, opts).items;
}

/**
 * Build the depth-sorted sprite draw list and the pre-cull liveness view in one pass — the shared core
 * of {@link import('./terrain-scene.js').buildScene}, {@link buildSpriteScene} and the retained pool's
 * per-frame reconcile, which needs both and would otherwise classify every entity twice per frame. Each
 * drawable entity is projected to its feet anchor and tagged with the render-side reads (state/facing/
 * carrying/atomic/buildingType) a per-kind binding needs; the per-kind reads run only for items that
 * survive the cull. Sorted by feet anchor `(y, x)` then entity id — a total, stable order, so both
 * culling and the entity source (full walk vs the spatial index's arbitrary bucket order) leave the
 * emitted list identical. Each option is documented on {@link SpriteSceneOptions}.
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
  const items: MutableDrawItem[] = [];
  // Refs collected while emitting. In the walk modes this IS the liveness set; in the index mode it
  // only carries what the index cannot answer (signpost board refs, fog-ghost refs, this frame's
  // emitted candidates) and the map-wide answer is the membership view built at the bottom.
  const collected = new Set<number>();
  // Target positions for facing mid-swing actors and aiming projectiles: built once per snapshot and
  // reused across the frames that render it (see targetPositionsOf), empty when no actor needs it.
  const posByRef = targetPositionsOf(snapshot);
  const enterableStores = enterableStoresOf(snapshot);

  const emit = (entity: EntitySnapshot): void => {
    // Drawn by the retained static layer instead (a virgin map resource) — not worth a classify.
    if (staticRefs?.has(entity.id)) return;
    const components = entity.components;
    const kind = classify(components);
    if (kind === null) return;
    const pos = readPosition(components);
    if (pos === null) return;
    // The details-panel portrait's subject is force-emitted through every cull below, so its live cutout
    // never blanks off-screen or when it steps inside a building.
    const isPortrait = portraitRef !== undefined && entity.id === portraitRef;
    // A settler inside a building (mid-exchange in a completed store, or the `Resting` marker in its
    // workplace) stays live/pooled but is not drawn, unless `keepIndoorSettlers` (the worker field) or the
    // portrait force overrides it.
    let indoorSettler = false;
    if (kind === 'settler') {
      const store = readStoreExchangeRef(components);
      indoorSettler = 'Resting' in components || (store !== null && enterableStores.has(store));
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
    // Only settlers animate per-state in this slice; a building/resource is always idle. An indoor
    // settler is forced idle so a lingering path/atomic from the tick it stepped inside can't leave it
    // walking or mid-swing in the panel's portrait.
    const state: SpriteState = kind === 'settler' && !indoorSettler ? readSpriteState(components) : 'idle';
    const actingAtomic = kind === 'settler' && !indoorSettler ? readActingAtomic(components) : null;
    // A mid-swing attacker/harvester faces its target but plays the swing in place: the drawn anchor
    // never moves toward the enemy/node. The swing frames carry their own authored advance in the
    // per-frame foot offsets, so any extra positional nudge doubles that motion and reads as the body
    // sliding over the ground at every swing. The axe/blade reach is the art's job.
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
    // Cull to the framed viewport. Uses the drawn anchor; the box is pre-inflated by the renderer to
    // cover a tall sprite's extent, so a building straddling the edge still draws. The portrait subject is
    // never culled — it must stay drawn for its cutout even when scrolled off-screen.
    const offscreen = viewport !== undefined && !isVisible(viewport, drawX, drawY);
    if (offscreen && !isPortrait) return;
    // Fog-of-war cull: an entity on ground the viewer does not currently see stays pooled but draws
    // nothing, the same contract as the viewport cull. After the viewport cull on purpose: the fog probe
    // costs a mask lookup per call, so it runs for the few on-screen entities, not the map.
    const fogged = fogVisible !== undefined && !fogVisible(tileX, tileY);
    if (fogged && !isPortrait) return;
    // Terrain lift at the feet (bilinear over the elevation lane) is the draw offset, not the depth key:
    // the anchor and `depth` below stay pre-lift so occlusion sorts by map row, not by lifted screen y.
    // A flat map (`maxLift === 0`) skips the sampler entirely.
    const lift = terrainLiftAt(elevation, tileX, tileY);
    // A projectile's ballistic height (set in its branch below) rides the same lift channel as terrain:
    // a pure draw offset the depth key never sees, so the lob can't reshuffle occlusion mid-flight.
    let arcLift = 0;
    const item: MutableDrawItem = {
      kind,
      ref: entity.id,
      x: drawX,
      y: drawY,
      // Feet-anchor depth: lower (greater y), then further-right (greater x), then the per-kind paint
      // bias, then id. A total order, so the sort is deterministic regardless of snapshot iteration order.
      depth: spriteDepth(tileX, tileY, kind, isFlag),
      state,
    };
    // Per-kind dispatch; each helper documents the fields its kind carries (`collect-fields.ts`).
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
        // Rides the lift draw channel, like terrain lift — never the depth key (see assignProjectileArc).
        arcLift = assignProjectileArc(item, components, screen, posByRef);
        break;
      case 'stockpile':
      case 'grounddrop':
        assignStockpileFields(item, components, isFlag);
        break;
      default: {
        // Exhaustiveness guard: a new SpriteKind fails to assign to `never` here instead of silently
        // taking the stockpile branch's fields.
        const _exhaustive: never = kind;
        void _exhaustive;
      }
    }
    const drawLift = lift + arcLift;
    if (drawLift !== 0) item.lift = drawLift;
    // The portrait subject that only survived a cull (off-screen/fogged/indoor) is drawn for the panel
    // cutout but hidden on the main map.
    if (isPortrait && (offscreen || fogged || indoorSettler)) item.portraitOnly = true;
    // Only `keepIndoorSettlers` or `portraitRef` gets an indoor settler this far, and both draw it holding
    // a motionless standing pose: it is not out working, and the atomic it left running would animate.
    if (indoorSettler) item.frozen = true;
    // Owner slot → team-colour slot (a map roster's colour choice); identity when unmapped.
    if (playerColourOf !== undefined && item.player !== undefined) {
      item.player = playerColourOf(item.player);
    }
    items.push(item);
  };

  // In the walk modes `collected` IS the liveness set. The index mode never walks the map, so its
  // answer becomes a view: the frame's own refs (boards, ghosts, emitted candidates — `collected` is
  // probed live, so the ghost refs pushed below are covered) plus the index's drawables minus the
  // statically drawn.
  let liveRefs: LiveRefs = collected;
  if (index !== undefined && viewport !== undefined && onlyRefs === undefined) {
    // Screen-bounded source: only the index buckets under the viewport; each candidate still runs the
    // exact per-item cull above, so the emitted set matches the full walk's.
    index.update(snapshot);
    for (const entity of index.query(viewport)) emit(entity);
    // The force-emitted portrait subject may sit outside the queried buckets — resolve it by id.
    if (portraitRef !== undefined && !collected.has(portraitRef)) {
      const subject = entityById(snapshot, portraitRef);
      if (subject !== undefined) emit(subject);
    }
    liveRefs = { has: (ref) => collected.has(ref) || (index.has(ref) && staticRefs?.has(ref) !== true) };
  } else if (onlyRefs !== undefined) {
    // A handful of known refs (the worker field's ≤8 settlers): resolve each by binary search instead
    // of walking a decoded map's tens of thousands of entities per tick.
    for (const ref of onlyRefs) {
      const entity = entityById(snapshot, ref);
      if (entity !== undefined) emit(entity);
    }
  } else {
    for (const entity of snapshot.entities) emit(entity);
  }

  if (ghosts !== undefined) pushGhostItems(items, collected, ghosts, viewport, elevation);
  // Stable, total order: (y, x) via `depth`, then the entity-id tie-break for two sprites on one tile.
  items.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return { items, liveRefs };
}
