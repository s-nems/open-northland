import { UNLOADED_GOOD_TYPE } from '@open-northland/data';
import { type EntitySnapshot, entityById, isPositioned, type WorldSnapshot } from '@open-northland/sim';
import type { GhostSource } from '../fog/index.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../projection/index.js';
import type { ElevationField } from '../terrain/index.js';
import { pushEffectItems, pushGhostItems } from './collect-fields.js';
import type { SpriteDepthOrder } from './depth-order.js';
import { type MutableSpriteDrawItem, type SpriteDrawItem, unsetDrawField } from './draw-item.js';
import { DrawList } from './draw-list.js';
import { anchorTileBox, emitEntities } from './entity-source.js';
import { type HolyFireLookup, holyFireOverlays } from './holy-fire.js';
import type { InHousePose, InHouseProgramLookup } from './in-house.js';
import { assembleItem, type SceneBuild } from './item-assembly.js';
import { isSelfContainedKind, type SceneItemMemo } from './item-memo.js';
import { palisadeLayoutOf } from './palisade-connections.js';
import { collectRebuiltPositioned, type TouchedIds, touchedIdsOf } from './scene-feeds.js';
import { craftAnchorOf, inHouseDrawAt, STANDING_POSE, settlerPose, vehiclePose } from './settler-pose.js';
import { isIndoorSettler, targetPositionsOf } from './snapshot-index.js';
import { classify, readPosition, vehicleDrawTile } from './snapshot-readers/index.js';

/** Whether a ref is alive (drawable) this frame. A `ReadonlySet` satisfies it; the viewport build
 *  serves it without materializing the map-wide set, which is why it is not a set type. */
export interface LiveRefs {
  has(ref: number): boolean;
}

export interface SpriteScene {
  readonly items: SpriteDrawItem[];
  /** Membership over every drawable entity before the cull: a ref answering false has died, one
   *  answering true but absent from {@link items} is merely off-screen. The viewport build's view reads
   *  the snapshot's position index, which a mirror advances in place, so it answers for the mirror's
   *  newest snapshot. */
  readonly liveRefs: LiveRefs;
  /** Present on a spliced build: per item of {@link items}, 1 for a self-contained item kept from the
   *  last build (its entity untouched since), 0 for an item this build emitted. */
  readonly kept?: Uint8Array;
  /** Present on a spliced build: the self-contained entities the deltas touched since the last build,
   *  whose kept items it dropped. */
  readonly touchedStatics?: ReadonlySet<number>;
}

/** Every field accepts an explicit `undefined` so callers can pass through their own optionals. */
export interface SpriteSceneOptions {
  /** The (margin-inflated) world-space camera box - cull to it; absent = emit every sprite. With it
   *  (and no `onlyRefs`) the build reads only the snapshot's positioned entities under the box. */
  readonly viewport?: Viewport | undefined;
  /** The map's terrain-height field; absent/flat = no lift. */
  readonly elevation?: ElevationField | undefined;
  /** Entities the retained static map-object layer draws instead (a decoded map's virgin resource nodes) -
   *  skipped entirely: no draw item, excluded from {@link SpriteScene.liveRefs}. */
  readonly staticRefs?: ReadonlySet<number> | undefined;
  /** Entities whose sprites wait for a presentation over them to end (a felled tree's trunk pile and
   *  stump under its falling clip): skipped like {@link staticRefs}. */
  readonly withheldRefs?: ReadonlySet<number> | undefined;
  /** The fog-of-war cull; absent = no fog. An entity whose tile it rejects is treated like a
   *  viewport-culled one: no draw item, but kept live so its pooled sprite survives until the fog
   *  lifts. */
  readonly fogVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  /** Version of {@link fogVisible}'s answers: a build may keep last build's self-contained items only
   *  under the same one. Absent with a fog cull, every build emits every entity. */
  readonly fogEpoch?: number | undefined;
  /** The viewer's remembered statics, drawn dimmed on explored ground; every drawable ghost, on screen
   *  or not, answers live in {@link SpriteScene.liveRefs}, so a dead entity keeps its pooled sprite for
   *  as long as the memory draws. A ref never yields two items: the store holds no record on visible
   *  ground, the fog cull drops live items elsewhere, and a vehicle drawn live suppresses its ghost. */
  readonly ghosts?: GhostSource | undefined;
  /** Keep settlers that are inside a building, forced to the `idle` standing pose. The map hides these
   *  (observed original: off-duty workers wait in the house). Approximation: how the original's
   *  building window presents one indoors is unverified. */
  readonly keepIndoorSettlers?: boolean;
  /** Keep the riders aboard a vehicle, which stand nowhere on the map: each stands idle on its
   *  vehicle's spot, for a figure drawn outside the map. */
  readonly keepAboardRiders?: boolean;
  /** The details-panel portrait's subject: emitted even when the viewport/fog cull or the
   *  indoor-settler suppression would drop it, so its live cutout never blanks. Absent = no portrait
   *  open. */
  readonly portraitRef?: number | undefined;
  /** The building the portrait's settler subject is inside. With it named, a subject nothing
   *  choreographs in there is left hidden (no frozen figure over the panel's backdrop) and the building
   *  is emitted through the cull in its place, so the portrait can frame the house the person went into. */
  readonly portraitHouse?: number | undefined;
  /** The other portrait insets' subjects (buildings a window frames, the vehicle a portrait subject
   *  rides): emitted through the viewport and fog culls like {@link portraitRef}, `portraitOnly` when the
   *  main map would have dropped them. */
  readonly insetRefs?: readonly number[] | undefined;
  /** Owner slot → team-colour slot, when a map's roster recolours players away from the slot-id
   *  default. Absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  /** The indoor craft choreography. A worker whose `(tribe, job, action)` it does not choreograph - or
   *  every worker, when it is absent - stays hidden inside its house. */
  readonly inHousePrograms?: InHouseProgramLookup | undefined;
  /** Source-authored home anchors and the resolved looping flame effect. */
  readonly holyFire?: HolyFireLookup | undefined;
}

/**
 * `onlyRefs` narrows {@link SpriteScene.liveRefs} too, which is why it is not on
 * {@link SpriteSceneOptions}: the retained pool's reconcile would read a narrowed set as "everything
 * else died" and destroy the map's sprites.
 */
export interface DrawListOptions extends SpriteSceneOptions {
  /** Emit draw items for these entities only; absent = every entity. The snapshot-wide lookups still
   *  cover the whole snapshot, so indoor state and target-derived facing resolve exactly as on the map. */
  readonly onlyRefs?: ReadonlySet<number> | undefined;
}

/** The depth-sorted sprite draw list alone, without terrain. An item is kept iff its screen anchor is
 *  inside the already margin-inflated `viewport` box. */
export function buildSpriteScene(snapshot: WorldSnapshot, opts: DrawListOptions = {}): SpriteDrawItem[] {
  return collectScene(snapshot, opts).items;
}

/**
 * Build the draw list and the pre-cull liveness view in one pass, so a caller needing both does not
 * classify every entity twice per frame. The emitted order is total and stable, so neither culling nor
 * the entity source (full walk or the position index's arbitrary bucket order) changes the list.
 */
export function collectSpriteScene(
  snapshot: WorldSnapshot,
  opts: SpriteSceneOptions = {},
  order?: SpriteDepthOrder,
  memo?: SceneItemMemo,
  incremental?: IncrementalScene,
): SpriteScene {
  return collectScene(snapshot, opts, order, memo, incremental);
}

/** What the self-contained items of a build depend on besides their own entities. */
interface StaticInputs {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly elevation: ElevationField | undefined;
  readonly staticRefs: ReadonlySet<number> | undefined;
  readonly staticCount: number;
  readonly withheldRefs: ReadonlySet<number> | undefined;
  readonly fogVisible: SpriteSceneOptions['fogVisible'];
  readonly fogEpoch: number | undefined;
  readonly playerColourOf: SpriteSceneOptions['playerColourOf'];
}

function sameStaticInputs(a: StaticInputs, b: StaticInputs): boolean {
  return (
    a.minX === b.minX &&
    a.minY === b.minY &&
    a.maxX === b.maxX &&
    a.maxY === b.maxY &&
    a.elevation === b.elevation &&
    a.staticRefs === b.staticRefs &&
    a.staticCount === b.staticCount &&
    a.withheldRefs === b.withheldRefs &&
    a.fogVisible === b.fogVisible &&
    a.fogEpoch === b.fogEpoch &&
    a.playerColourOf === b.playerColourOf
  );
}

/**
 * A scene build's self-contained items (`SceneItemMemo`'s kinds), kept across builds of one view as a
 * run sorted like the draw list: a build re-emits only the entities a delta touched and the kinds that
 * read more than their own entity, and merges them into the run instead of emitting every entity under
 * the view again. Held by one build loop; the touch log it drains is shared by the snapshot lineage.
 */
export class IncrementalScene {
  statics: readonly SpriteDrawItem[] = [];
  inputs: StaticInputs | null = null;
  touched: TouchedIds | null = null;
  /** Whether the last build spliced the run rather than rebuilding it. */
  spliced = false;

  clear(): void {
    this.statics = [];
    this.inputs = null;
    this.touched = null;
  }
}

/** Depth, then ref: the order every build sorts its draw list in. */
function drawOrder(a: SpriteDrawItem, b: SpriteDrawItem): number {
  return a.depth - b.depth || a.ref - b.ref;
}

/** Two runs sorted by {@link drawOrder} merged into one, as sorting their union would order it: the
 *  left run's items carry `leftKept` flags, the right run's are emitted, and the merged order's flags go
 *  to `kept`. */
function mergeFlagged(
  left: readonly SpriteDrawItem[],
  leftKept: Uint8Array,
  right: readonly SpriteDrawItem[],
  kept: Uint8Array,
): SpriteDrawItem[] {
  const out = new Array<SpriteDrawItem>(left.length + right.length);
  let i = 0;
  let j = 0;
  let k = 0;
  while (i < left.length || j < right.length) {
    const a = left[i];
    const b = right[j];
    if (a !== undefined && (b === undefined || drawOrder(a, b) <= 0)) {
      kept[k] = leftKept[i] ?? 0;
      out[k++] = a;
      i++;
    } else if (b !== undefined) {
      kept[k] = 0;
      out[k++] = b;
      j++;
    }
  }
  return out;
}

/** Whether a build keeps `item` in its static run: exactly the items the touch log answers for, so only
 *  these may stand unvisited between builds. */
export function isStaticItem(item: SpriteDrawItem): boolean {
  return item.kind !== 'craftfx' && isSelfContainedKind(item.kind) && item.ghost !== true;
}

/** Reused query output of the incremental build. */
const rebuiltCandidates: EntitySnapshot[] = [];

function collectScene(
  snapshot: WorldSnapshot,
  opts: DrawListOptions,
  order?: SpriteDepthOrder,
  memo?: SceneItemMemo,
  incremental?: IncrementalScene,
): SpriteScene {
  const {
    viewport,
    elevation,
    staticRefs,
    withheldRefs,
    fogVisible,
    ghosts,
    keepIndoorSettlers,
    keepAboardRiders,
    portraitRef,
    portraitHouse,
    insetRefs,
    playerColourOf,
    inHousePrograms,
    holyFire,
  } = opts;
  const list = order?.list ?? new DrawList();
  list.begin();
  const collected = new Set<number>();
  const posByRef = targetPositionsOf(snapshot);
  // Vehicles are the one ghost kind that moves: one driven out of its fogged memory into sight draws live
  // while its memory, kept until its cell is re-seen, still holds it. Allocated on first need.
  let liveVehicles: Set<number> | undefined;
  const build: SceneBuild = {
    snapshot,
    list,
    collected,
    posByRef,
    elevation,
    playerColourOf,
    palisades: palisadeLayoutOf(snapshot, elevation),
  };

  memo?.begin(elevation, playerColourOf);
  const emit = (entity: EntitySnapshot, indexed: boolean): void => {
    // Drawn by the retained static layer instead, or not yet - skip before paying for a classify.
    if (staticRefs?.has(entity.id) || withheldRefs?.has(entity.id)) return;
    const isPortrait =
      (portraitRef !== undefined && entity.id === portraitRef) ||
      (portraitHouse !== undefined && entity.id === portraitHouse) ||
      (insetRefs?.includes(entity.id) ?? false);
    // The liveness view already answers for an indexed entity; a portrait subject is collected all the
    // same, which tells the forced emission it was drawn.
    const collects = !indexed || isPortrait;
    const known = isPortrait ? undefined : memo?.get(entity);
    if (known !== undefined) {
      if (collects) collected.add(entity.id);
      if (viewport !== undefined && !isVisible(viewport, known.screen.x, known.screen.y)) return;
      if (fogVisible !== undefined && !fogVisible(known.tileX, known.tileY)) return;
      known.item ??= assembleItem(
        build,
        entity,
        known.kind,
        known.tileX,
        known.tileY,
        known.screen,
        STANDING_POSE,
      );
      list.push(known.item);
      return;
    }
    const components = entity.components;
    const kind = classify(components);
    if (kind === null) return;
    const aboard =
      kind === 'settler' && keepAboardRiders === true ? aboardVehicleOf(snapshot, components) : null;
    const pos = readPosition(components) ?? (aboard === null ? null : readPosition(aboard.components));
    if (pos === null) return;
    if (collects) collected.add(entity.id);
    // An indoor settler stays live and pooled but draws nothing, unless kept or forced here - or unless
    // it is performing a craft the content choreographs, which the house then shows it doing. The portrait
    // subject resolves its craft too, or selecting a craftsman would empty his workshop. Only the anchor is
    // resolved here; the choreography itself waits until the cull below has kept the worker.
    const indoorSettler = kind === 'settler' && isIndoorSettler(snapshot, components);
    const hiddenIndoors = indoorSettler && keepIndoorSettlers !== true;
    const craft = hiddenIndoors ? craftAnchorOf(components, posByRef, snapshot.tick) : undefined;
    if (hiddenIndoors && craft === undefined && !isPortrait) return;
    // A driving vehicle draws part-way along its leg; everything else stands on its Position.
    const drawn = kind === 'vehicle' ? vehicleDrawTile(components, pos) : undefined;
    const tileX = craft?.tileX ?? drawn?.x ?? pos.x / ONE;
    const tileY = craft?.tileY ?? drawn?.y ?? pos.y / ONE;
    const screen = tileToScreen(tileX, tileY);
    const record = isPortrait ? undefined : memo?.remember(entity, kind, tileX, tileY, screen);
    // Culls on the drawn anchor; the caller pre-inflates the box to cover a tall sprite's extent, so a
    // building straddling the edge still draws.
    const offscreen = viewport !== undefined && !isVisible(viewport, screen.x, screen.y);
    if (offscreen && !isPortrait) return;
    // After the viewport cull on purpose: the fog probe costs a mask lookup per call, so it runs for
    // the few on-screen entities, not the map.
    const fogged = fogVisible !== undefined && !fogVisible(tileX, tileY);
    if (fogged && !isPortrait) return;

    const inHouse = craft !== undefined ? inHouseDrawAt(craft, inHousePrograms) : undefined;
    if (craft !== undefined && inHouse === undefined && !isPortrait) return;
    // The portrait subject inside a house nothing shows it in: with the house named, the house stands in.
    if (isPortrait && hiddenIndoors && inHouse === undefined && portraitHouse !== undefined) return;
    const pose =
      inHouse?.pose ??
      (kind === 'settler' && !indoorSettler && aboard === null
        ? settlerPose(components, tileX, tileY, posByRef)
        : kind === 'vehicle'
          ? vehiclePose(components)
          : STANDING_POSE);
    const item = assembleItem(build, entity, kind, tileX, tileY, screen, pose);
    if (record !== undefined) record.item = item;
    // Being choreographed excuses only the indoor hiding: the portrait frames the worker at his craft
    // instead of soloing a hidden sprite, but an offscreen or fogged subject still draws for it alone.
    if (isPortrait && (offscreen || fogged || (indoorSettler && inHouse === undefined)))
      item.portraitOnly = true;
    // A subject kept only for the portrait stages nothing: its effects would paint on the map the culls
    // just kept it off.
    const stagesEffects = item.portraitOnly !== true;
    if (inHouse !== undefined) {
      applyInHousePose(item, inHouse.inHouse);
      if (stagesEffects) pushEffectItems(list, collected, item, inHouse.overlays, screen, tileX, tileY);
    }
    // Only a kept or forced settler gets this far indoors without a craft to show.
    else if (indoorSettler) item.frozen = true;
    if (kind === 'building' && stagesEffects) {
      const fire = holyFireOverlays(snapshot, entity.id, components, holyFire);
      pushEffectItems(list, collected, item, fire, screen, tileX, tileY);
    }
    if (kind === 'vehicle' && item.portraitOnly !== true) {
      liveVehicles ??= new Set();
      liveVehicles.add(entity.id);
    }
    list.push(item);
  };

  const touched = incremental === undefined ? undefined : touchedIdsOf(snapshot);
  // A portrait forces its subjects through the culls, which a kept run cannot answer for.
  const inputs: StaticInputs | null =
    incremental === undefined ||
    viewport === undefined ||
    opts.onlyRefs !== undefined ||
    portraitRef !== undefined ||
    portraitHouse !== undefined ||
    (insetRefs?.length ?? 0) > 0 ||
    keepIndoorSettlers === true ||
    keepAboardRiders === true ||
    (fogVisible !== undefined && opts.fogEpoch === undefined)
      ? null
      : {
          minX: viewport.minX,
          minY: viewport.minY,
          maxX: viewport.maxX,
          maxY: viewport.maxY,
          elevation,
          staticRefs,
          staticCount: staticRefs?.size ?? 0,
          withheldRefs,
          fogVisible,
          fogEpoch: opts.fogEpoch,
          playerColourOf,
        };
  const splices =
    incremental !== undefined &&
    touched !== undefined &&
    viewport !== undefined &&
    inputs !== null &&
    incremental.inputs !== null &&
    incremental.touched === touched &&
    sameStaticInputs(incremental.inputs, inputs);

  let liveRefs: LiveRefs;
  let items: SpriteDrawItem[];
  let keptFlags: Uint8Array | undefined;
  let touchedStatics: ReadonlySet<number> | undefined;
  if (splices && viewport !== undefined && touched !== undefined && incremental !== undefined) {
    // The kinds rebuilt every build, then the self-contained entities the deltas touched since.
    const count = collectRebuiltPositioned(snapshot, anchorTileBox(viewport), rebuiltCandidates);
    for (let i = 0; i < count; i++) {
      const entity = rebuiltCandidates[i];
      if (entity !== undefined) emit(entity, true);
    }
    for (const id of touched.ids) {
      const entity = entityById(snapshot, id);
      const kind = entity === undefined ? null : classify(entity.components);
      if (entity !== undefined && kind !== null && isSelfContainedKind(kind)) emit(entity, true);
    }
    if (ghosts !== undefined) pushGhostItems(list, ghosts, viewport, elevation, liveVehicles, playerColourOf);
    const emittedItems = list.finish();
    const fresh: SpriteDrawItem[] = [];
    const others: SpriteDrawItem[] = [];
    for (const item of emittedItems) (isStaticItem(item) ? fresh : others).push(item);
    if (order !== undefined) order.sort(others);
    else others.sort(drawOrder);
    fresh.sort(drawOrder);
    // Most deltas touch no self-contained entity under the view: the run stands as it was.
    const keptRun =
      touched.ids.size === 0
        ? incremental.statics
        : incremental.statics.filter((i) => !touched.ids.has(i.ref));
    const staticKept = new Uint8Array(keptRun.length + fresh.length);
    let statics: readonly SpriteDrawItem[] = keptRun;
    if (fresh.length === 0) staticKept.fill(1);
    else statics = mergeFlagged(keptRun, new Uint8Array(keptRun.length).fill(1), fresh, staticKept);
    incremental.statics = statics;
    keptFlags = new Uint8Array(statics.length + others.length);
    items = mergeFlagged(statics, staticKept, others, keptFlags);
    touchedStatics = new Set(touched.ids);
    const positioned: LiveRefs = {
      has: (ref) => collected.has(ref) || (isPositioned(snapshot, ref) && staticRefs?.has(ref) !== true),
    };
    liveRefs = ghosts === undefined ? positioned : { has: (ref) => positioned.has(ref) || ghosts.has(ref) };
    incremental.spliced = true;
  } else {
    const emitted = emitEntities(snapshot, opts, collected, emit);
    if (ghosts !== undefined) pushGhostItems(list, ghosts, viewport, elevation, liveVehicles, playerColourOf);
    liveRefs = ghosts === undefined ? emitted : { has: (ref) => emitted.has(ref) || ghosts.has(ref) };
    items = list.finish();
    // `depth` carries the feet anchor plus the per-kind paint bias; id breaks a remaining exact tie.
    if (order !== undefined) order.sort(items);
    else items.sort(drawOrder);
    if (incremental !== undefined) {
      incremental.statics = inputs === null ? [] : items.filter(isStaticItem);
      incremental.spliced = false;
    }
  }
  if (incremental !== undefined) {
    incremental.inputs = inputs;
    incremental.touched = touched ?? null;
    touched?.ids.clear();
  }
  return keptFlags === undefined || touchedStatics === undefined
    ? { items, liveRefs }
    : { items, liveRefs, kept: keptFlags, touchedStatics };
}

/** Offset a choreographed worker from its house's anchor and give it the pose its program calls for. The
 *  program is the authority on the load indoors, overriding what the settler walked in holding. */
function applyInHousePose(item: MutableSpriteDrawItem, pose: InHousePose): void {
  item.inHouse = true;
  item.x += pose.dx;
  item.y += pose.dy;
  item.carrying = pose.goodType !== UNLOADED_GOOD_TYPE;
  if (pose.goodType !== UNLOADED_GOOD_TYPE) item.carryGood = pose.goodType;
  else unsetDrawField(item, 'carryGood');
  if (pose.clip !== undefined) item.craftClip = pose.clip;
}

/** The vehicle a rider without a `Position` sits in, or null for anyone standing on the map. */
function aboardVehicleOf(
  snapshot: WorldSnapshot,
  components: Readonly<Record<string, unknown>>,
): EntitySnapshot | null {
  if ('Position' in components) return null;
  const rider = components.Rider as { vehicle?: unknown } | undefined;
  return typeof rider?.vehicle === 'number' ? (entityById(snapshot, rider.vehicle) ?? null) : null;
}
