import type { Camera, EntityBounds, WorldRenderer } from '@open-northland/render';
import { entityById, type WorldSnapshot } from '@open-northland/sim';
import { isSettler, isVehicle, isWildlife, type SnapshotEntity } from '../game/snapshot/index.js';
import type { HoverCard } from '../hud/dom/hover-card.js';
import type {
  BuildingHoverModel,
  HoverCardModel,
  SettlerHoverModel,
  VehicleHoverModel,
} from '../hud/hover-card/model.js';
import { containsTargetPoint, drawnInFront, isHitTarget, screenToWorld } from './picking.js';
import type { SettlerProxy } from './unit-controls/click-hits.js';

/**
 * What the cursor is over in the world: a settler, a building, a vehicle or another seat's wall opens a
 * card, and so does a sign row on a building or a work flag, as the settler a click on it selects. Hit
 * targets are filtered from the renderer's already-culled `drawnItems`, so the work follows the screen,
 * not the map. Goods heaps, chests and nature are named by the unit controls' label beside
 * the cursor instead.
 */

/** How long the cursor rests on one target before its card opens, so crossing a settlement does not
 *  flash a card over every house and passer-by on the way. */
const CARD_REST_MS = 150;
/** How far, in client px, the pointer may drift and still rest where it is, so a hand's tremor does not
 *  count as moving to another target. */
const POINTER_REST_SLOP_PX = 4;

export interface WorldHoverOptions {
  readonly renderer: WorldRenderer;
  readonly camera: () => Camera;
  /** client (CSS) px to screen px. */
  readonly clientToScreen: (clientX: number, clientY: number) => { x: number; y: number };
  /** The card a hovered settler, building, vehicle or wall opens; its owner creates and disposes it. */
  readonly card: HoverCard;
  readonly buildingModel: (snapshot: WorldSnapshot, entityId: number) => BuildingHoverModel | null;
  readonly settlerModel: (snapshot: WorldSnapshot, entityId: number) => SettlerHoverModel | null;
  readonly vehicleModel: (snapshot: WorldSnapshot, entityId: number) => VehicleHoverModel | null;
  readonly palisadeModel: (snapshot: WorldSnapshot, entityId: number) => BuildingHoverModel | null;
  /** Whether a wall opens a card at all; one that does not is no hover target, so it hides nothing
   *  behind it. */
  readonly wallHovers: (entity: SnapshotEntity) => boolean;
  /** Bumps whenever the models above would read differently within one tick: a spectator's seat switch
   *  turns another seat's card into an own one and back, and a sim answer the worker's products read
   *  lands. */
  readonly modelVersion: () => number;
  /** Solid-texel refinement of a building's or vehicle's drawn box, so its transparent corner hovers the
   *  ground. */
  readonly pixelHitOf: ((ref: number, wx: number, wy: number) => boolean | undefined) | undefined;
  /** Cursor position in client coords, or null when the pointer left the canvas. */
  readonly pointer: () => { readonly clientX: number; readonly clientY: number } | null;
  /** The settler a sign row or a work flag under the client point stands for, whose card it opens
   *  unless a unit drawn in front covers it. */
  readonly settlerProxyAt: (clientX: number, clientY: number) => SettlerProxy | null;
  /** Whether the world hover must yield the pointer this frame, because placement or HUD chrome owns it. */
  readonly suppressed: (clientX: number, clientY: number) => boolean;
}

export interface WorldHover {
  /** `nowMs` is the frame's timestamp; it times the rest the card waits for. */
  update(snapshot: WorldSnapshot, nowMs: number): void;
  /** The target the last {@link update} picked: what the cursor rests over among settlers, buildings,
   *  walls and vehicles. Null on nothing and while the pointer is claimed or off the canvas. The frame loop hands it to the renderer one frame later, for the
   *  hovered-target outline. */
  hovered(): number | null;
  destroy(): void;
}

/** The targets that open the card. */
type CardKind = 'building' | 'settler' | 'vehicle' | 'palisade';

/** A drawn item the hover may name, as its frame drew it: `box` is its bounds then. Whether its entity
 *  takes the hover is read only once the pointer lands on it. */
interface HoverCandidate {
  ref: number;
  x: number;
  y: number;
  kind: CardKind;
  box: EntityBounds | undefined;
}

/** What the pointer is over: the frontmost person, else the frontmost other target, and whether the
 *  target the hover holds is still one of them. */
interface HoverHits {
  person: HoverCandidate | null;
  rest: HoverCandidate | null;
  /** Whether the held target is still under the point and takes the hover. */
  heldHit: boolean;
}

export function createWorldHover(opts: WorldHoverOptions): WorldHover {
  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const p = opts.clientToScreen(clientX, clientY);
    return screenToWorld(opts.camera(), p.x, p.y);
  };

  // The drawn list is culled to the viewport, so the candidates key on the camera as well as the tick.
  // They are copied once per key into retained slots; the entity reads wait for a point that hits one.
  let candidatesKey = '';
  const candidates: HoverCandidate[] = [];
  let candidateCount = 0;
  const candidateSlot = (): HoverCandidate => {
    let slot = candidates[candidateCount];
    if (slot === undefined) {
      slot = { ref: 0, x: 0, y: 0, kind: 'settler', box: undefined };
      candidates.push(slot);
    }
    candidateCount++;
    return slot;
  };
  const collectCandidates = (snap: WorldSnapshot): void => {
    const cam = opts.camera();
    const key = `${snap.tick}:${cam.offsetX}:${cam.offsetY}:${cam.scale ?? 1}`;
    if (key === candidatesKey) return;
    candidatesKey = key;
    candidateCount = 0;
    for (const it of opts.renderer.drawnItems()) {
      if (!isHitTarget(it)) continue;
      if (it.kind !== 'settler' && it.kind !== 'building' && it.kind !== 'palisade' && it.kind !== 'vehicle')
        continue;
      const slot = candidateSlot();
      slot.ref = it.ref;
      slot.x = it.x;
      slot.y = it.y;
      slot.kind = it.kind;
      slot.box = opts.renderer.entityBounds(it.ref);
    }
  };

  /** Whether `c`'s entity takes the hover. */
  const hovers = (snap: WorldSnapshot, c: HoverCandidate): boolean => {
    switch (c.kind) {
      case 'settler': {
        const entity = entityById(snap, c.ref);
        // Wildlife and livestock draw as settlers too, and neither has a name or a trade to show.
        return entity !== undefined && isSettler(entity) && !isWildlife(entity);
      }
      case 'building':
        return true;
      case 'palisade': {
        const entity = entityById(snap, c.ref);
        return entity !== undefined && opts.wallHovers(entity);
      }
      case 'vehicle': {
        const entity = entityById(snap, c.ref);
        return entity !== undefined && isVehicle(entity);
      }
    }
  };

  /** Whether `c` is under world point (`wx`, `wy`): in its box, and on a solid texel of a building, wall
   *  or vehicle. */
  const under = (c: HoverCandidate, wx: number, wy: number): boolean => {
    if (!containsTargetPoint(c.kind, c.x, c.y, c.box, wx, wy)) return false;
    const pixelHitOf = opts.pixelHitOf;
    const pixels = c.kind === 'building' || c.kind === 'palisade' || c.kind === 'vehicle';
    return !pixels || pixelHitOf === undefined || (pixelHitOf(c.ref, wx, wy) ?? true);
  };

  const hits: HoverHits = { person: null, rest: null, heldHit: false };
  const hitsAt = (snap: WorldSnapshot, wx: number, wy: number, held: number | null): HoverHits => {
    collectCandidates(snap);
    hits.person = null;
    hits.rest = null;
    hits.heldHit = false;
    for (let i = 0; i < candidateCount; i++) {
      const c = candidates[i];
      if (c === undefined) continue;
      const person = c.kind === 'settler';
      const best = person ? hits.person : hits.rest;
      if (best !== null && !drawnInFront(c, best) && c.ref !== held) continue;
      if (!under(c, wx, wy) || !hovers(snap, c)) continue;
      if (c.ref === held) hits.heldHit = true;
      if (best !== null && !drawnInFront(c, best)) continue;
      if (person) hits.person = c;
      else hits.rest = c;
    }
    return hits;
  };

  // The card's model is rebuilt only when the target, the tick or `modelVersion` changes; the frames in
  // between show the model already standing.
  let cardKey = '';
  let cardModel: HoverCardModel | null = null;
  const modelFor = (snap: WorldSnapshot, ref: number, kind: CardKind): HoverCardModel | null => {
    const key = `${ref}:${snap.tick}:${opts.modelVersion()}`;
    if (key !== cardKey) {
      cardKey = key;
      cardModel =
        kind === 'building'
          ? opts.buildingModel(snap, ref)
          : kind === 'settler'
            ? opts.settlerModel(snap, ref)
            : kind === 'palisade'
              ? opts.palisadeModel(snap, ref)
              : opts.vehicleModel(snap, ref);
    }
    return cardModel;
  };

  // A proxy reads the door markers and the drawn flags, so it is asked again only when the tick, the
  // camera, the pointer or the viewer's seat moves.
  let proxyKey = '';
  let proxy: SettlerProxy | null = null;
  const proxyAt = (snap: WorldSnapshot, clientX: number, clientY: number): SettlerProxy | null => {
    const cam = opts.camera();
    const key = `${snap.tick}:${cam.offsetX}:${cam.offsetY}:${cam.scale ?? 1}:${clientX}:${clientY}:${opts.modelVersion()}`;
    if (key !== proxyKey) {
      proxyKey = key;
      proxy = opts.settlerProxyAt(clientX, clientY);
    }
    return proxy;
  };

  // The target the cursor is on and when it arrived; leaving one restarts the rest it owes.
  let restingOn: number | null = null;
  let restingSince = 0;
  // The target of the current hover, for the renderer's outline; the suppressed frames hold none.
  let outlined: number | null = null;
  const restedOn = (ref: number, nowMs: number): boolean => {
    if (ref !== restingOn) {
      restingOn = ref;
      restingSince = nowMs;
    }
    return nowMs - restingSince >= CARD_REST_MS;
  };

  // Where the pointer last stopped over the world, and the target the hover holds there. While neither
  // the pointer nor the camera moves, that target keeps the hover for as long as it is still under it: a
  // fighter swinging across a gate, or anyone walking past a house, would otherwise take the top spot
  // frame by frame and restart the rest each time, so the card never opens. Moving either picks the
  // frontmost target again.
  let restAt: { readonly x: number; readonly y: number; readonly camera: Camera } | null = null;
  let held: number | null = null;
  let heldKind: CardKind | null = null;
  /** Whether the held settler came through a sign row or a work flag rather than its own sprite. */
  let heldByProxy = false;
  const pointerMoved = (clientX: number, clientY: number): boolean => {
    const camera = opts.camera();
    const moved =
      restAt === null ||
      restAt.camera.offsetX !== camera.offsetX ||
      restAt.camera.offsetY !== camera.offsetY ||
      restAt.camera.scale !== camera.scale ||
      Math.abs(clientX - restAt.x) > POINTER_REST_SLOP_PX ||
      Math.abs(clientY - restAt.y) > POINTER_REST_SLOP_PX;
    if (moved) restAt = { x: clientX, y: clientY, camera: { ...camera } };
    return moved;
  };
  const hideCard = (): void => {
    restingOn = null;
    opts.card.hide();
  };

  return {
    destroy: () => hideCard(),
    hovered: () => outlined,
    update(snap: WorldSnapshot, nowMs: number): void {
      const p = opts.pointer();
      if (p === null || opts.suppressed(p.clientX, p.clientY)) {
        restAt = null;
        held = null;
        heldByProxy = false;
        outlined = null;
        hideCard();
        return;
      }
      const w = toWorld(p.clientX, p.clientY);
      const moved = pointerMoved(p.clientX, p.clientY);
      const found = hitsAt(snap, w.x, w.y, held);
      const marked = proxyAt(snap, p.clientX, p.clientY);
      // A resting pointer keeps its target: a carrier passing in front of a sign row covers it only for
      // a moment, and a marker turning up under a held unit does not take it over.
      const keep = !moved && held !== null && (heldByProxy ? marked?.ref === held : found.heldHit);
      const proxied = !keep && marked !== null && !marked.covered;
      const target = keep || proxied ? null : (found.person ?? found.rest);
      const ref = keep ? held : proxied ? marked.ref : (target?.ref ?? null);
      const kind: CardKind | null = keep ? heldKind : proxied ? 'settler' : (target?.kind ?? null);
      heldByProxy = keep ? heldByProxy : proxied;
      held = ref;
      heldKind = kind;
      outlined = ref;
      if (ref === null || kind === null) {
        hideCard();
        return;
      }
      // The card's own hide, not hideCard(): a rest still running must not restart under itself.
      const model = restedOn(ref, nowMs) ? modelFor(snap, ref, kind) : null;
      if (model === null) opts.card.hide();
      else opts.card.show(p.clientX, p.clientY, model);
    },
  };
}
