import {
  buildSpriteScene,
  type DrawItem,
  resolveLayers,
  type SpriteSheet,
  settlerPaletteLutRow,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { type Application, Container, Graphics } from 'pixi.js';
import type { Rect } from '../../geometry.js';
import { SettlerSpritePool } from '../../settler-sprite-pool.js';

/** The standing pose: the idle sequence's first frame, for a frozen figure. */
export const STILL_POSE_TICK = 0;
/** The thumbnail backing under a figure: the card's slate, translucent over the map and solid where
 *  fanned cards cover each other. */
const BACKING_COLOUR = 0x182521;
const BACKING_ALPHA = 0.53;
const BACKING_ALPHA_OPAQUE = 0.96;
const BACKING_RADIUS = 8;
/** Stacking slots per thumbnail: its backing, then the figure's layers above it. */
const THUMB_Z_SLOTS = 2;

/** One card's thumbnail as the column places it, in canvas px. */
export interface NotePortraitEntry {
  readonly entity: number;
  /** The thumbnail box, already cut to the list's visible area. */
  readonly box: Rect;
  /** The figure's feet anchor and the map-px multiplier it draws at. */
  readonly feetX: number;
  readonly feetY: number;
  readonly zoom: number;
  /** True when a fanned card behind this one must not show through the backing. */
  readonly opaque: boolean;
}

/**
 * The settlers drawn on their cards' thumbnails, as on the map but without terrain: this Pixi layer
 * sits under the DOM cards, which leave their thumbnail boxes clear. Without a sprite sheet it draws
 * nothing and the cards still work.
 */
export class NotePortraits {
  private readonly root = new Container();
  private readonly mask = new Graphics();
  private readonly backings: Graphics[] = [];
  private readonly pool: SettlerSpritePool;

  constructor(
    app: Application,
    private readonly sheet: SpriteSheet | undefined,
    parent: Container,
    private readonly playerColourOf?: (player: number) => number,
  ) {
    this.root.sortableChildren = true;
    this.root.mask = this.mask;
    this.root.addChild(this.mask);
    parent.addChild(this.root);
    this.pool = new SettlerSpritePool(app, sheet, this.root);
  }

  /** `entries` come in paint order, the card in front last; `clock` is the animation tick, or null to
   *  hold every figure on its standing frame. */
  render(snapshot: WorldSnapshot, entries: readonly NotePortraitEntry[], clock: number | null): void {
    this.pool.begin();
    this.mask.clear();
    for (const backing of this.backings) backing.visible = false;
    if (entries.length === 0) {
      this.pool.hideRest();
      return;
    }
    const scene =
      this.sheet === undefined
        ? []
        : buildSpriteScene(snapshot, {
            playerColourOf: this.playerColourOf,
            keepIndoorSettlers: true,
            onlyRefs: new Set(entries.map((e) => e.entity)),
          });
    const items = new Map<number, DrawItem>();
    for (const it of scene) if (it.kind === 'settler') items.set(it.ref, it);
    entries.forEach((entry, i) => {
      const { box } = entry;
      this.mask.roundRect(box.x, box.y, box.w, box.h, BACKING_RADIUS).fill(0xffffff);
      const backing = this.backing(i);
      backing.clear();
      backing.roundRect(box.x, box.y, box.w, box.h, BACKING_RADIUS).fill(BACKING_COLOUR);
      backing.alpha = entry.opaque ? BACKING_ALPHA_OPAQUE : BACKING_ALPHA;
      backing.zIndex = i * THUMB_Z_SLOTS;
      backing.visible = true;
      const item = items.get(entry.entity);
      if (item === undefined || this.sheet === undefined) return;
      const tick = clock === null || item.frozen === true ? STILL_POSE_TICK : clock;
      const layers = resolveLayers(this.sheet, item, tick);
      if (layers === null) return;
      const row = settlerPaletteLutRow(this.sheet, item);
      for (const [li, layer] of layers.entries()) {
        this.pool.drawLayer(
          `${i}:${li}`,
          layer,
          entry.feetX,
          entry.feetY,
          entry.zoom,
          row,
          i * THUMB_Z_SLOTS + 1,
        );
      }
    });
    this.pool.hideRest();
  }

  dispose(): void {
    this.pool.dispose();
    this.root.destroy({ children: true });
  }

  private backing(i: number): Graphics {
    let backing = this.backings[i];
    if (backing === undefined) {
      backing = new Graphics();
      this.backings[i] = backing;
      this.root.addChild(backing);
    }
    return backing;
  }
}
