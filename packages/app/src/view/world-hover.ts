import type { ContentSet } from '@open-northland/data';
import type { Camera, WorldRenderer } from '@open-northland/render';
import { type ChestKind, entityById, type WorldSnapshot } from '@open-northland/sim';
import type { UiString } from '../content/gui-gfx.js';
import { canOpenChest, chestKindOf, isSettler, isWildlife, ownerPlayerOf } from '../game/snapshot.js';
import type { HoverCard } from '../hud/dom/hover-card.js';
import type { BuildingHoverModel, HoverCardModel, SettlerHoverModel } from '../hud/hover-card/model.js';
import { messages } from '../i18n/index.js';
import { isHitTarget, type Pickable, pickTopAt, screenToWorld } from './picking.js';
import { createTooltip } from './tooltip.js';

/**
 * What the cursor is over in the world: a settler or a building opens a card, a loose good pile or a
 * chest a text chip. Hit targets are filtered from the renderer's already-culled `drawnItems`, so the
 * work follows the screen, not the map. Owns the chip element; the details panel's stock-row tooltip
 * must not share it.
 */

/** How long the cursor rests on one target before its card opens, so crossing a settlement does not
 *  flash a card over every house and passer-by on the way. */
const CARD_REST_MS = 250;

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
  /** The card a hovered settler or building opens; its owner creates and disposes it. */
  readonly card: HoverCard;
  readonly buildingModel: (snapshot: WorldSnapshot, entityId: number) => BuildingHoverModel | null;
  readonly settlerModel: (snapshot: WorldSnapshot, entityId: number) => SettlerHoverModel | null;
  /** Solid-texel refinement of a building's drawn box, so its transparent corner hovers the ground. */
  readonly pixelHitOf: ((ref: number, wx: number, wy: number) => boolean | undefined) | undefined;
  /** Cursor position in client coords, or null when the pointer left the canvas. */
  readonly pointer: () => { readonly clientX: number; readonly clientY: number } | null;
  /** Whether the world hover must yield the pointer this frame, because placement or HUD chrome owns it. */
  readonly suppressed: (clientX: number, clientY: number) => boolean;
}

export interface WorldHover {
  /** `nowMs` is the frame's timestamp; it times the rest the card waits for. */
  update(snapshot: WorldSnapshot, nowMs: number): void;
  destroy(): void;
}

type HoverInfo =
  | { readonly kind: 'pile'; readonly goodType: number; readonly amount: number }
  | { readonly kind: 'chest'; readonly chestKind: ChestKind }
  | { readonly kind: 'building' }
  | { readonly kind: 'settler' };

/** The hit targets of one drawn frame, people apart: a settler answers the cursor before whatever it
 *  stands on or in front of. */
interface HoverTargets {
  readonly people: Pickable[];
  readonly rest: Pickable[];
}

export function createWorldHover(opts: WorldHoverOptions): WorldHover {
  const tooltip = createTooltip();

  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const p = opts.clientToScreen(clientX, clientY);
    return screenToWorld(opts.camera(), p.x, p.y);
  };

  // The drawn list is culled to the viewport, so the hit-target cache keys on the camera as well as
  // the tick.
  let hoverKey = '';
  let hoverTargets: HoverTargets = { people: [], rest: [] };
  const hoverInfo = new Map<number, HoverInfo>();
  const hoverTargetsFor = (snap: WorldSnapshot): HoverTargets => {
    const cam = opts.camera();
    const key = `${snap.tick}:${cam.offsetX}:${cam.offsetY}:${cam.scale ?? 1}`;
    if (key === hoverKey) return hoverTargets;
    hoverKey = key;
    hoverTargets = { people: [], rest: [] };
    hoverInfo.clear();
    const pixelHitOf = opts.pixelHitOf;
    for (const it of opts.renderer.drawnItems()) {
      if (!isHitTarget(it)) continue;
      if (it.kind === 'settler') {
        const entity = entityById(snap, it.ref);
        // Wildlife and livestock draw as settlers too, and neither has a name or a trade to show.
        if (entity === undefined || !isSettler(entity) || isWildlife(entity)) continue;
        hoverTargets.people.push({
          ref: it.ref,
          x: it.x,
          y: it.y,
          kind: 'settler',
          box: opts.renderer.entityBounds(it.ref),
        });
        hoverInfo.set(it.ref, { kind: 'settler' });
        continue;
      }
      if (it.kind === 'building') {
        hoverTargets.rest.push({
          ref: it.ref,
          x: it.x,
          y: it.y,
          kind: 'building',
          box: opts.renderer.entityBounds(it.ref),
          ...(pixelHitOf !== undefined
            ? { pixelHit: (wx: number, wy: number) => pixelHitOf(it.ref, wx, wy) }
            : {}),
        });
        hoverInfo.set(it.ref, { kind: 'building' });
        continue;
      }
      if (it.kind === 'chest') {
        const entity = entityById(snap, it.ref);
        const chestKind = entity === undefined ? undefined : chestKindOf(entity);
        if (chestKind === undefined) continue;
        hoverTargets.rest.push({
          ref: it.ref,
          x: it.x,
          y: it.y,
          kind: 'chest',
          box: opts.renderer.entityBounds(it.ref),
        });
        hoverInfo.set(it.ref, { kind: 'chest', chestKind });
        continue;
      }
      if (it.kind !== 'stockpile' && it.kind !== 'grounddrop') continue;
      if (it.goodType === undefined) continue; // an empty delivery flag - nothing to name
      hoverTargets.rest.push({ ref: it.ref, x: it.x, y: it.y, box: opts.renderer.entityBounds(it.ref) });
      hoverInfo.set(it.ref, { kind: 'pile', goodType: it.goodType, amount: it.fill ?? 0 });
    }
    return hoverTargets;
  };

  // The card's model is rebuilt only when the target or the tick changes; the frames in between show
  // the model already standing.
  let cardKey = '';
  let cardModel: HoverCardModel | null = null;
  const modelFor = (
    snap: WorldSnapshot,
    ref: number,
    kind: 'building' | 'settler',
  ): HoverCardModel | null => {
    const key = `${ref}:${snap.tick}`;
    if (key !== cardKey) {
      cardKey = key;
      cardModel = kind === 'building' ? opts.buildingModel(snap, ref) : opts.settlerModel(snap, ref);
    }
    return cardModel;
  };

  // The target the cursor is on and when it arrived; leaving one restarts the rest it owes.
  let restingOn: number | null = null;
  let restingSince = 0;
  const restedOn = (ref: number, nowMs: number): boolean => {
    if (ref !== restingOn) {
      restingOn = ref;
      restingSince = nowMs;
    }
    return nowMs - restingSince >= CARD_REST_MS;
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
    update(snap: WorldSnapshot, nowMs: number): void {
      const p = opts.pointer();
      if (p === null || opts.suppressed(p.clientX, p.clientY)) {
        hideAll();
        return;
      }
      const w = toWorld(p.clientX, p.clientY);
      const targets = hoverTargetsFor(snap);
      const ref = pickTopAt(targets.people, w.x, w.y) ?? pickTopAt(targets.rest, w.x, w.y);
      const info = ref === null ? undefined : hoverInfo.get(ref);
      if (info === undefined || ref === null) {
        hideAll();
        return;
      }
      if (info.kind === 'building' || info.kind === 'settler') {
        tooltip.hide();
        // The card's own hide, not hideCard(): a rest still running must not restart under itself.
        const model = restedOn(ref, nowMs) ? modelFor(snap, ref, info.kind) : null;
        if (model === null) opts.card.hide();
        else opts.card.show(p.clientX, p.clientY, model);
        return;
      }
      if (info.kind === 'chest') {
        const order = opts.chestOrderLine(snap, info.chestKind);
        const name = opts.chestLabel(info.chestKind);
        chip(p.clientX, p.clientY, order === null ? name : `${name} · ${order}`);
        return;
      }
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
  player: number,
  selectedIds: () => ReadonlySet<number>,
): Pick<WorldHoverOptions, 'chestLabel' | 'chestOrderLine'> {
  const labels = messages().hud.chest;
  return {
    chestLabel: (kind) => uiString('misc', CHEST_NAME_STRING_ID[kind], labels[kind]),
    chestOrderLine: (snapshot, kind) => {
      for (const id of selectedIds()) {
        const e = entityById(snapshot, id);
        if (e === undefined || !isSettler(e) || ownerPlayerOf(e) !== player) continue;
        if (canOpenChest(e, kind, content)) return uiString('misclogic', OPEN_CHEST_STRING_ID, labels.open);
      }
      return null;
    },
  };
}
