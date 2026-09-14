import type { ContentSet } from '@open-northland/data';
import type { Camera, WorldRenderer } from '@open-northland/render';
import { type ChestKind, entityById, type WorldSnapshot } from '@open-northland/sim';
import type { UiString } from '../content/gui-gfx.js';
import { canOpenChest, chestKindOf, isSettler, ownerPlayerOf } from '../game/snapshot.js';
import { messages } from '../i18n/index.js';
import { isHitTarget, type Pickable, pickTopAt, screenToWorld } from './picking.js';
import { createTooltip } from './tooltip.js';

/**
 * Cursor tooltip naming the loose good pile or the chest under the pointer. Hit targets are filtered
 * from the renderer's already-culled `drawnItems`, so the work follows the screen, not the map. Owns its
 * own tooltip element; the details panel's stock-row tooltip must not share that DOM node.
 */

export interface WorldTooltipOptions {
  readonly renderer: WorldRenderer;
  readonly camera: () => Camera;
  /** client (CSS) px to screen px. */
  readonly clientToScreen: (clientX: number, clientY: number) => { x: number; y: number };
  /** The good's localized display name. */
  readonly goodLabel: (goodType: number) => string | undefined;
  /** A chest's localized name, per kind. */
  readonly chestLabel: (kind: ChestKind) => string;
  /** The order line under a chest's name: the open order when the selection can open it, the reason
   *  when it cannot, null with nothing selected. */
  readonly chestOrderLine: (snapshot: WorldSnapshot, kind: ChestKind) => string | null;
  /** Cursor position in client coords, or null when the pointer left the canvas. */
  readonly pointer: () => { readonly clientX: number; readonly clientY: number } | null;
  /** Whether the world tooltip must yield the pointer this frame, because placement or HUD chrome owns it. */
  readonly suppressed: (clientX: number, clientY: number) => boolean;
}

export interface WorldTooltip {
  update(snapshot: WorldSnapshot): void;
  destroy(): void;
}

type HoverInfo =
  | { readonly kind: 'pile'; readonly goodType: number; readonly amount: number }
  | { readonly kind: 'chest'; readonly chestKind: ChestKind };

export function createWorldTooltip(opts: WorldTooltipOptions): WorldTooltip {
  const tooltip = createTooltip();

  const toWorld = (clientX: number, clientY: number): { x: number; y: number } => {
    const p = opts.clientToScreen(clientX, clientY);
    return screenToWorld(opts.camera(), p.x, p.y);
  };

  // The drawn list is culled to the viewport, so the hit-target cache keys on the camera as well as
  // the tick.
  let hoverKey = '';
  let hoverTargets: Pickable[] = [];
  const hoverInfo = new Map<number, HoverInfo>();
  const hoverTargetsFor = (snap: WorldSnapshot): Pickable[] => {
    const cam = opts.camera();
    const key = `${snap.tick}:${cam.offsetX}:${cam.offsetY}:${cam.scale ?? 1}`;
    if (key === hoverKey) return hoverTargets;
    hoverKey = key;
    hoverTargets = [];
    hoverInfo.clear();
    for (const it of opts.renderer.drawnItems()) {
      if (!isHitTarget(it)) continue;
      if (it.kind === 'chest') {
        const entity = entityById(snap, it.ref);
        const chestKind = entity === undefined ? undefined : chestKindOf(entity);
        if (chestKind === undefined) continue;
        hoverTargets.push({
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
      hoverTargets.push({ ref: it.ref, x: it.x, y: it.y, box: opts.renderer.entityBounds(it.ref) });
      hoverInfo.set(it.ref, { kind: 'pile', goodType: it.goodType, amount: it.fill ?? 0 });
    }
    return hoverTargets;
  };

  return {
    destroy: () => tooltip.destroy(),
    update(snap: WorldSnapshot): void {
      const p = opts.pointer();
      if (p === null || opts.suppressed(p.clientX, p.clientY)) {
        tooltip.hide();
        return;
      }
      const w = toWorld(p.clientX, p.clientY);
      const ref = pickTopAt(hoverTargetsFor(snap), w.x, w.y);
      const info = ref === null ? undefined : hoverInfo.get(ref);
      if (info === undefined || ref === null) {
        tooltip.hide();
        return;
      }
      if (info.kind === 'chest') {
        const order = opts.chestOrderLine(snap, info.chestKind);
        const name = opts.chestLabel(info.chestKind);
        tooltip.show(p.clientX, p.clientY, order === null ? name : `${name} · ${order}`);
        return;
      }
      const label = opts.goodLabel(info.goodType) ?? `#${info.goodType}`;
      tooltip.show(p.clientX, p.clientY, info.amount > 1 ? `${label} ×${info.amount}` : label);
    },
  };
}

/** The `misc` rows naming the two chest kinds, and the `misclogic` row naming the open order. */
const CHEST_NAME_STRING_ID: Readonly<Record<ChestKind, number>> = { wooden: 112, magical: 113 };
const OPEN_CHEST_STRING_ID = 35;

/**
 * The chest lines of the world tooltip over the live sim: the kind's name, and under it the open order
 * when `player`'s selection holds an adult who may open that kind, the druid-or-hero note when it holds
 * settlers who may not, nothing with no settler selected.
 */
export function chestTooltipLines(
  content: ContentSet,
  uiString: UiString,
  player: number,
  selectedIds: () => ReadonlySet<number>,
): Pick<WorldTooltipOptions, 'chestLabel' | 'chestOrderLine'> {
  const labels = messages().hud.chest;
  return {
    chestLabel: (kind) => uiString('misc', CHEST_NAME_STRING_ID[kind], labels[kind]),
    chestOrderLine: (snapshot, kind) => {
      let selected = false;
      for (const id of selectedIds()) {
        const e = entityById(snapshot, id);
        if (e === undefined || !isSettler(e) || ownerPlayerOf(e) !== player) continue;
        selected = true;
        if (canOpenChest(e, kind, content)) return uiString('misclogic', OPEN_CHEST_STRING_ID, labels.open);
      }
      return selected && kind === 'magical' ? labels.magicalOnly : null;
    },
  };
}
