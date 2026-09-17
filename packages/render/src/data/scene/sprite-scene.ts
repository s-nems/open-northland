import { UNLOADED_GOOD_TYPE } from '@open-northland/data';
import type { EntitySnapshot, WorldSnapshot } from '@open-northland/sim';
import type { FogGhost } from '../fog/index.js';
import { isVisible, ONE, tileToScreen, type Viewport } from '../projection/index.js';
import { attackSmokeShowing } from '../sprites/vehicle.js';
import type { ElevationField } from '../terrain/index.js';
import { pushBuildingFxItems, pushCraftFxItems, pushGhostItems } from './collect-fields.js';
import type { MutableSpriteDrawItem, SpriteDrawItem } from './draw-item.js';
import { emitEntities } from './entity-source.js';
import { type HolyFireLookup, holyFireOverlays } from './holy-fire.js';
import type { InHouseOverlay, InHousePose, InHouseProgramLookup } from './in-house.js';
import { assembleItem, type SceneBuild } from './item-assembly.js';
import { palisadeLayoutOf } from './palisade-connections.js';
import { craftAnchorOf, inHouseDrawAt, STANDING_POSE, settlerPose, vehiclePose } from './settler-pose.js';
import { isIndoorSettler, targetPositionsOf } from './snapshot-index.js';
import { classify, readPosition } from './snapshot-readers/index.js';
import type { SpriteSpatialIndex } from './spatial-index.js';

/** Whether a ref is alive (drawable) this frame. A `ReadonlySet` satisfies it; the index-backed build
 *  serves it without materializing the map-wide set, which is why it is not a set type. */
export interface LiveRefs {
  has(ref: number): boolean;
}

export interface SpriteScene {
  readonly items: SpriteDrawItem[];
  /** Membership over every drawable entity before the cull: a ref answering false has died, one
   *  answering true but absent from {@link items} is merely off-screen. The index-backed view reads
   *  shared mutable state, so it stays valid only until the index is next updated. */
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
  /** The caller's retained {@link SpriteSpatialIndex}: with a `viewport`, the build walks only its
   *  buckets under the camera instead of every snapshot entity, and updates the index itself. Ignored
   *  without a `viewport` or with `onlyRefs`. */
  readonly index?: SpriteSpatialIndex | undefined;
  /** The fog-of-war cull; absent = no fog. An entity whose tile it rejects is treated like a
   *  viewport-culled one: no draw item, but kept live so its pooled sprite survives until the fog
   *  lifts. */
  readonly fogVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  /** The viewer's remembered statics, drawn dimmed on explored ground and joined to
   *  {@link SpriteScene.liveRefs}. A ref never yields two items: the store deletes records on visible
   *  ground, and the fog cull drops live items elsewhere. */
  readonly ghosts?: readonly FogGhost[] | undefined;
  /** Keep settlers that are inside a building, forced to the `idle` standing pose. The map hides these
   *  (observed original: off-duty workers wait in the house). Approximation: how the original's
   *  building window presents one indoors is unverified. */
  readonly keepIndoorSettlers?: boolean;
  /** The details-panel portrait's subject: emitted even when the viewport/fog cull or the
   *  indoor-settler suppression would drop it, so its live cutout never blanks. Absent = no portrait
   *  open. */
  readonly portraitRef?: number | undefined;
  /** Owner slot → team-colour slot, when a map's roster recolours players away from the slot-id
   *  default. Absent = identity. */
  readonly playerColourOf?: ((player: number) => number) | undefined;
  /** The indoor craft choreography. A worker whose `(tribe, job, action)` it does not choreograph - or
   *  every worker, when it is absent - stays hidden inside its house. */
  readonly inHousePrograms?: InHouseProgramLookup | undefined;
  /** Source-authored home anchors and the resolved looping flame effect. */
  readonly holyFire?: HolyFireLookup | undefined;
  /** The smoke an attacking catapult stages beside itself while its shot lingers; absent stages none. */
  readonly vehicleAttackFx?: InHouseOverlay | undefined;
}

/**
 * `onlyRefs` narrows {@link SpriteScene.liveRefs} too, which is why it is not on
 * {@link SpriteSceneOptions}: the retained pool's reconcile would read a narrowed set as "everything
 * else died" and destroy the map's sprites.
 */
export interface DrawListOptions extends SpriteSceneOptions {
  /** Emit draw items for these entities only; absent = every entity. Every pre-scan still reads the
   *  whole snapshot, so indoor state and target-derived facing resolve exactly as on the map. */
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
 * the entity source (full walk or the index's arbitrary bucket order) changes the list.
 */
export function collectSpriteScene(snapshot: WorldSnapshot, opts: SpriteSceneOptions = {}): SpriteScene {
  return collectScene(snapshot, opts);
}

function collectScene(snapshot: WorldSnapshot, opts: DrawListOptions): SpriteScene {
  const {
    viewport,
    elevation,
    staticRefs,
    fogVisible,
    ghosts,
    keepIndoorSettlers,
    portraitRef,
    playerColourOf,
    inHousePrograms,
    holyFire,
    vehicleAttackFx,
  } = opts;
  const items: MutableSpriteDrawItem[] = [];
  const collected = new Set<number>();
  const posByRef = targetPositionsOf(snapshot);
  const build: SceneBuild = {
    snapshot,
    items,
    collected,
    posByRef,
    elevation,
    playerColourOf,
    palisades: palisadeLayoutOf(snapshot, elevation),
  };

  const emit = (entity: EntitySnapshot): void => {
    // Drawn by the retained static layer instead - skip before paying for a classify.
    if (staticRefs?.has(entity.id)) return;
    const components = entity.components;
    const kind = classify(components);
    if (kind === null) return;
    const pos = readPosition(components);
    if (pos === null) return;
    const isPortrait = portraitRef !== undefined && entity.id === portraitRef;
    collected.add(entity.id);
    // An indoor settler stays live and pooled but draws nothing, unless kept or forced here - or unless
    // it is performing a craft the content choreographs, which the house then shows it doing. The portrait
    // subject resolves its craft too, or selecting a craftsman would empty his workshop. Only the anchor is
    // resolved here; the choreography itself waits until the cull below has kept the worker.
    const indoorSettler = kind === 'settler' && isIndoorSettler(snapshot, components);
    const hiddenIndoors = indoorSettler && keepIndoorSettlers !== true;
    const craft = hiddenIndoors ? craftAnchorOf(components, posByRef) : undefined;
    if (hiddenIndoors && craft === undefined && !isPortrait) return;
    const tileX = craft?.tileX ?? pos.x / ONE;
    const tileY = craft?.tileY ?? pos.y / ONE;
    const screen = tileToScreen(tileX, tileY);
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
    const pose =
      inHouse?.pose ??
      (kind === 'settler' && !indoorSettler
        ? settlerPose(components, tileX, tileY, posByRef)
        : kind === 'vehicle'
          ? vehiclePose(components)
          : STANDING_POSE);
    const item = assembleItem(build, entity, kind, tileX, tileY, screen, pose);
    // Being choreographed excuses only the indoor hiding: the portrait frames the worker at his craft
    // instead of soloing a hidden sprite, but an offscreen or fogged subject still draws for it alone.
    if (isPortrait && (offscreen || fogged || (indoorSettler && inHouse === undefined)))
      item.portraitOnly = true;
    if (inHouse !== undefined) {
      applyInHousePose(item, inHouse.inHouse);
      // A subject kept only for the portrait stages nothing: its effects would paint on the map the culls
      // just kept it off.
      if (item.portraitOnly !== true) {
        pushCraftFxItems(items, collected, item, inHouse.overlays, screen, tileX, tileY);
      }
    }
    // Only a kept or forced settler gets this far indoors without a craft to show.
    else if (indoorSettler) item.frozen = true;
    else if (
      kind === 'vehicle' &&
      item.task === 'attacks' &&
      vehicleAttackFx !== undefined &&
      attackSmokeShowing(snapshot.tick)
    ) {
      pushCraftFxItems(items, collected, item, [vehicleAttackFx], screen, tileX, tileY);
    }
    if (kind === 'building') {
      pushBuildingFxItems(
        items,
        collected,
        item,
        holyFireOverlays(snapshot, entity.id, components, holyFire),
        tileX,
        tileY,
      );
    }
    items.push(item);
  };

  const liveRefs = emitEntities(snapshot, opts, collected, emit);
  if (ghosts !== undefined) pushGhostItems(items, collected, ghosts, viewport, elevation);
  // `depth` carries the feet anchor plus the per-kind paint bias; id breaks a remaining exact tie.
  items.sort((a, b) => a.depth - b.depth || a.ref - b.ref);
  return { items, liveRefs };
}

/** Offset a choreographed worker from its house's anchor and give it the pose its program calls for. The
 *  program is the authority on the load indoors, overriding what the settler walked in holding. */
function applyInHousePose(item: MutableSpriteDrawItem, pose: InHousePose): void {
  item.inHouse = true;
  item.x += pose.dx;
  item.y += pose.dy;
  item.carrying = pose.goodType !== UNLOADED_GOOD_TYPE;
  if (pose.goodType !== UNLOADED_GOOD_TYPE) item.carryGood = pose.goodType;
  else delete item.carryGood;
  if (pose.clip !== undefined) item.craftClip = pose.clip;
}
