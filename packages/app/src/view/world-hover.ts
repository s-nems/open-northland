import type { ContentSet } from '@open-northland/data';
import type { Camera, EntityBounds, WorldRenderer } from '@open-northland/render';
import { type ChestKind, entityById, type WorldSnapshot } from '@open-northland/sim';
import type { UiString } from '../content/gui/gfx.js';
import {
  canOpenChest,
  chestKindOf,
  isSettler,
  isVehicle,
  isWildlife,
  ownerPlayerOf,
  type SnapshotEntity,
} from '../game/snapshot/index.js';
import type { HoverCard } from '../hud/dom/hover-card.js';
import type {
  BuildingHoverModel,
  HoverCardModel,
  SettlerHoverModel,
  VehicleHoverModel,
} from '../hud/hover-card/model.js';
import { messages } from '../i18n/index.js';
import { containsTargetPoint, drawnInFront, isHitTarget, screenToWorld } from './picking.js';
import { createTooltip } from './tooltip.js';

/**
 * What the cursor is over in the world: a settler, a building, a vehicle or another seat's wall opens a
 * card, a loose good pile or a chest a text chip. Hit targets are filtered from the renderer's
 * already-culled `drawnItems`, so the work follows the screen, not the map. Owns the chip element; the
 * details panel's stock-row tooltip must not share it.
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
  /** The good's localized display name. */
  readonly goodLabel: (goodType: number) => string | undefined;
  /** A chest's localized name, per kind. */
  readonly chestLabel: (kind: ChestKind) => string;
  /** The order line after a chest's name: the open order when the selection can open it, else null. */
  readonly chestOrderLine: (snapshot: WorldSnapshot, kind: ChestKind) => string | null;
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
  /** Whether the world hover must yield the pointer this frame, because placement or HUD chrome owns it. */
  readonly suppressed: (clientX: number, clientY: number) => boolean;
}

export interface WorldHover {
  /** `nowMs` is the frame's timestamp; it times the rest the card waits for. */
  update(snapshot: WorldSnapshot, nowMs: number): void;
  /** The card-kind target the last {@link update} picked: what the cursor rests over among settlers,
   *  buildings, walls and vehicles. Null on nothing, on a chip target, and while the pointer is
   *  claimed or off the canvas. The frame loop hands it to the renderer one frame later, for the
   *  hovered-target outline. */
  hovered(): number | null;
  destroy(): void;
}

type HoverInfo =
  | { readonly kind: 'pile'; readonly goodType: number; readonly amount: number }
  | { readonly kind: 'chest'; readonly chestKind: ChestKind }
  | { readonly kind: 'building' }
  | { readonly kind: 'settler' }
  | { readonly kind: 'vehicle' }
  | { readonly kind: 'palisade' };

/** The targets that open the card rather than a chip. */
type CardKind = 'building' | 'settler' | 'vehicle' | 'palisade';

/** A drawn item the hover may name, as its frame drew it: `box` is its bounds then. Whether its entity
 *  takes the hover is read only once the pointer lands on it. */
interface HoverCandidate {
  ref: number;
  x: number;
  y: number;
  kind: HoverCandidateKind;
  box: EntityBounds | undefined;
  goodType: number;
  fill: number;
}

type HoverCandidateKind = 'settler' | 'building' | 'palisade' | 'chest' | 'vehicle' | 'pile';

/** What the pointer is over: the frontmost person, else the frontmost other target, and whether the
 *  target the hover holds is still one of them. */
interface HoverHits {
  person: HoverCandidate | null;
  personInfo: HoverInfo | undefined;
  rest: HoverCandidate | null;
  restInfo: HoverInfo | undefined;
  heldInfo: HoverInfo | undefined;
}

const SETTLER_INFO: HoverInfo = { kind: 'settler' };
const BUILDING_INFO: HoverInfo = { kind: 'building' };
const PALISADE_INFO: HoverInfo = { kind: 'palisade' };
const VEHICLE_INFO: HoverInfo = { kind: 'vehicle' };

export function createWorldHover(opts: WorldHoverOptions): WorldHover {
  const tooltip = createTooltip();

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
      slot = { ref: 0, x: 0, y: 0, kind: 'settler', box: undefined, goodType: 0, fill: 0 };
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
      let kind: HoverCandidateKind;
      if (
        it.kind === 'settler' ||
        it.kind === 'building' ||
        it.kind === 'palisade' ||
        it.kind === 'chest' ||
        it.kind === 'vehicle'
      )
        kind = it.kind;
      else if ((it.kind === 'stockpile' || it.kind === 'grounddrop') && it.goodType !== undefined)
        kind = 'pile'; // an empty delivery flag names nothing
      else continue;
      const slot = candidateSlot();
      slot.ref = it.ref;
      slot.x = it.x;
      slot.y = it.y;
      slot.kind = kind;
      slot.box = opts.renderer.entityBounds(it.ref);
      slot.goodType = it.goodType ?? 0;
      slot.fill = it.fill ?? 0;
    }
  };

  /** What `c` shows when its entity takes the hover, else undefined. */
  const infoOf = (snap: WorldSnapshot, c: HoverCandidate): HoverInfo | undefined => {
    switch (c.kind) {
      case 'settler': {
        const entity = entityById(snap, c.ref);
        // Wildlife and livestock draw as settlers too, and neither has a name or a trade to show.
        return entity === undefined || !isSettler(entity) || isWildlife(entity) ? undefined : SETTLER_INFO;
      }
      case 'building':
        return BUILDING_INFO;
      case 'palisade': {
        const entity = entityById(snap, c.ref);
        return entity === undefined || !opts.wallHovers(entity) ? undefined : PALISADE_INFO;
      }
      case 'chest': {
        const entity = entityById(snap, c.ref);
        const chestKind = entity === undefined ? undefined : chestKindOf(entity);
        return chestKind === undefined ? undefined : { kind: 'chest', chestKind };
      }
      case 'vehicle': {
        const entity = entityById(snap, c.ref);
        return entity === undefined || !isVehicle(entity) ? undefined : VEHICLE_INFO;
      }
      case 'pile':
        return { kind: 'pile', goodType: c.goodType, amount: c.fill };
    }
  };

  /** Whether `c` is under world point (`wx`, `wy`): in its box, a pile and a person by the settler box,
   *  and on a solid texel of a building, wall or vehicle. */
  const under = (c: HoverCandidate, wx: number, wy: number): boolean => {
    const boxKind = c.kind === 'pile' ? 'settler' : c.kind;
    if (!containsTargetPoint(boxKind, c.x, c.y, c.box, wx, wy)) return false;
    const pixelHitOf = opts.pixelHitOf;
    const pixels = c.kind === 'building' || c.kind === 'palisade' || c.kind === 'vehicle';
    return !pixels || pixelHitOf === undefined || (pixelHitOf(c.ref, wx, wy) ?? true);
  };

  const hits: HoverHits = {
    person: null,
    personInfo: undefined,
    rest: null,
    restInfo: undefined,
    heldInfo: undefined,
  };
  const hitsAt = (snap: WorldSnapshot, wx: number, wy: number, held: number | null): HoverHits => {
    collectCandidates(snap);
    hits.person = null;
    hits.personInfo = undefined;
    hits.rest = null;
    hits.restInfo = undefined;
    hits.heldInfo = undefined;
    for (let i = 0; i < candidateCount; i++) {
      const c = candidates[i];
      if (c === undefined) continue;
      const person = c.kind === 'settler';
      const best = person ? hits.person : hits.rest;
      if (best !== null && !drawnInFront(c, best) && c.ref !== held) continue;
      if (!under(c, wx, wy)) continue;
      const info = infoOf(snap, c);
      if (info === undefined) continue;
      if (c.ref === held) hits.heldInfo = info;
      if (best !== null && !drawnInFront(c, best)) continue;
      if (person) {
        hits.person = c;
        hits.personInfo = info;
      } else {
        hits.rest = c;
        hits.restInfo = info;
      }
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

  // The target the cursor is on and when it arrived; leaving one restarts the rest it owes.
  let restingOn: number | null = null;
  let restingSince = 0;
  // The card-kind target of the current hover, for the renderer's outline; a chest, a pile, wildlife
  // and the suppressed frames hold none, as none of them opens a card.
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
  const chip = (clientX: number, clientY: number, text: string): void => {
    hideCard();
    tooltip.show(clientX, clientY, text);
  };
  const hideAll = (): void => {
    hideCard();
    tooltip.hide();
  };

  return {
    destroy: () => tooltip.destroy(),
    hovered: () => outlined,
    update(snap: WorldSnapshot, nowMs: number): void {
      const p = opts.pointer();
      if (p === null || opts.suppressed(p.clientX, p.clientY)) {
        restAt = null;
        held = null;
        outlined = null;
        hideAll();
        return;
      }
      const w = toWorld(p.clientX, p.clientY);
      const moved = pointerMoved(p.clientX, p.clientY);
      const found = hitsAt(snap, w.x, w.y, held);
      const keep = !moved && held !== null && found.heldInfo !== undefined;
      const top = found.person ?? found.rest;
      const ref = keep ? held : (top?.ref ?? null);
      const info = keep ? found.heldInfo : found.person !== null ? found.personInfo : found.restInfo;
      held = ref;
      if (info === undefined || ref === null) {
        outlined = null;
        hideAll();
        return;
      }
      if (
        info.kind === 'building' ||
        info.kind === 'settler' ||
        info.kind === 'vehicle' ||
        info.kind === 'palisade'
      ) {
        outlined = ref;
        tooltip.hide();
        // The card's own hide, not hideCard(): a rest still running must not restart under itself.
        const model = restedOn(ref, nowMs) ? modelFor(snap, ref, info.kind) : null;
        if (model === null) opts.card.hide();
        else opts.card.show(p.clientX, p.clientY, model);
        return;
      }
      if (info.kind === 'chest') {
        outlined = null;
        const order = opts.chestOrderLine(snap, info.chestKind);
        const name = opts.chestLabel(info.chestKind);
        chip(p.clientX, p.clientY, order === null ? name : `${name} · ${order}`);
        return;
      }
      outlined = null;
      const label = opts.goodLabel(info.goodType) ?? `#${info.goodType}`;
      chip(p.clientX, p.clientY, info.amount > 1 ? `${label} ×${info.amount}` : label);
    },
  };
}

/** The `misc` rows naming the two chest kinds, and the `misclogic` row naming the open order. */
const CHEST_NAME_STRING_ID: Readonly<Record<ChestKind, number>> = { wooden: 112, magical: 113 };
const OPEN_CHEST_STRING_ID = 35;

/**
 * The chest lines of the world hover over the live sim: the kind's name, and after it the open order
 * when `player`'s selection holds an adult who may open that kind; otherwise the name alone.
 */
export function chestTooltipLines(
  content: ContentSet,
  uiString: UiString,
  player: () => number,
  selectedIds: () => ReadonlySet<number>,
): Pick<WorldHoverOptions, 'chestLabel' | 'chestOrderLine'> {
  const labels = messages().hud.chest;
  return {
    chestLabel: (kind) => uiString('misc', CHEST_NAME_STRING_ID[kind], labels[kind]),
    chestOrderLine: (snapshot, kind) => {
      for (const id of selectedIds()) {
        const e = entityById(snapshot, id);
        if (e === undefined || !isSettler(e) || ownerPlayerOf(e) !== player()) continue;
        if (canOpenChest(e, kind, content)) return uiString('misclogic', OPEN_CHEST_STRING_ID, labels.open);
      }
      return null;
    },
  };
}
