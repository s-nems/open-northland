import {
  buildSpriteScene,
  type DrawItem,
  paletteLutRow,
  resolveLayers,
  type SpriteSheet,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import { type Application, Container } from 'pixi.js';
import { SettlerSpritePool } from '../../settler-sprite-pool.js';

/** The standing pose: the idle sequence's first frame, so a note never animates. */
const STILL_POSE_TICK = 0;
/** The settler's feet on the note, in design px from its top-left corner (approximation: the original
 *  symbols). */
export const PORTRAIT_FEET_X = 0x1b;
export const PORTRAIT_FEET_Y = 0x33;

export interface NotePortraitEntry {
  readonly entity: number;
  /** Feet anchor in screen px. */
  readonly feetX: number;
  readonly feetY: number;
}

/**
 * The settlers drawn standing on their notes, as on the map but frozen and without terrain. Without a
 * sprite sheet it draws nothing and the notes still work.
 */
export class NotePortraits {
  private readonly container = new Container();
  private readonly pool: SettlerSpritePool;

  constructor(
    app: Application,
    private readonly sheet: SpriteSheet | undefined,
    parent: Container,
    private readonly playerColourOf?: (player: number) => number,
  ) {
    parent.addChild(this.container);
    this.pool = new SettlerSpritePool(app, sheet, this.container);
  }

  /** `scale` is the design-px multiplier the note art is drawn at; bodies keep their native size in it. */
  render(snapshot: WorldSnapshot, entries: readonly NotePortraitEntry[], scale: number): void {
    this.pool.begin();
    if (this.sheet === undefined || entries.length === 0) {
      this.pool.hideRest();
      return;
    }
    const scene = buildSpriteScene(snapshot, {
      playerColourOf: this.playerColourOf,
      keepIndoorSettlers: true,
      onlyRefs: new Set(entries.map((e) => e.entity)),
    });
    const items = new Map<number, DrawItem>();
    for (const it of scene) if (it.kind === 'settler') items.set(it.ref, it);
    const lut = this.sheet.palette;
    entries.forEach((entry, i) => {
      const item = items.get(entry.entity);
      if (item === undefined) return;
      const layers = resolveLayers(this.sheet, item, STILL_POSE_TICK);
      if (layers === null) return;
      const row = lut === undefined ? 0 : paletteLutRow(lut, item.player, item.armorGood);
      for (const [li, layer] of layers.entries()) {
        this.pool.drawLayer(`${i}:${li}`, layer, entry.feetX, entry.feetY, scale, row);
      }
    });
    this.pool.hideRest();
  }

  dispose(): void {
    this.pool.dispose();
    this.container.destroy({ children: true });
  }
}
