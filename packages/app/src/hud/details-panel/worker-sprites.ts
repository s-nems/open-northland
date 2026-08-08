import {
  buildSpriteScene,
  type DrawItem,
  PalettedSprite,
  paletteLutRow,
  type ResolvedLayer,
  resolveLayers,
  type SpriteSheet,
} from '@open-northland/render';
import type { WorldSnapshot } from '@open-northland/sim';
import {
  type Application,
  Container,
  type Container as PixiContainer,
  Rectangle,
  Sprite,
  Texture,
} from 'pixi.js';
import type { Rect } from '../geometry.js';
import { fieldWorkers, groupedWorkers } from './worker-selection.js';

/**
 * The animated worker sprites drawn in the details panel's "Pracownicy" field: the settlers the selected
 * building holds, drawn as on the map but with no terrain behind them. Without a loaded
 * {@link SpriteSheet} it draws nothing and the panel still works.
 */

/** A worker who has stepped inside the building stands frozen on this animation tick; 0 holds the idle
 *  sequence's first (neutral standing) frame. */
const INDOOR_POSE_TICK = 0;
/** Inset from the field edges (screen px), the fraction of the field height a character fills, and one
 *  worker's cell width as a fraction of the field height (they pack left-to-right by this width). */
const FIELD_PAD = 4;
const CHAR_FILL = 0.82;
const SLOT_W_FRAC = 0.72;

/** One drawn worker's clickable box (screen px) → its entity, so a click on the sprite selects it. */
interface WorkerHit {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export class WorkerSpriteOverlay {
  private readonly container: PixiContainer = new Container();
  /** One display object per (panel slot, layerIndex), keyed by slot rather than by entity so the pool
   *  cannot grow past the field's slot count × the deepest layer stack. */
  private readonly sprites = new Map<string, PalettedSprite | Sprite>();
  /** Cached plain textures (the no-LUT fallback) keyed by atlas frame identity, so the fallback path
   *  doesn't mint a Texture every frame. */
  private readonly plainTextures = new Map<object, Texture>();
  private readonly drawn = new Set<string>();
  /** This frame's clickable worker boxes, rebuilt each update. */
  private hits: WorkerHit[] = [];

  constructor(
    private readonly app: Application,
    private readonly sheet: SpriteSheet | undefined,
    zIndex: number,
    /** Owner slot → team-colour slot, matching the map's own sprites. */
    private readonly playerColourOf?: (player: number) => number,
  ) {
    this.container.zIndex = zIndex;
    this.container.visible = false;
    app.stage.addChild(this.container);
  }

  /**
   * Redraw the workers of `buildingId` into `field` (screen px); a null building or field, or no sprite
   * sheet, clears the overlay. `opts.siteCrew` selects the live build crew instead of the bound workers,
   * and `opts.groups` (one id list per family) replaces the bound-worker scan. An empty grouping is not
   * an override: a home still going up houses nobody yet, and blanking its field would hide the crew
   * raising it.
   */
  update(
    snapshot: WorldSnapshot,
    buildingId: number | null,
    field: Rect | null,
    opts: { siteCrew?: boolean; groups?: readonly (readonly number[])[] } = {},
  ): void {
    const { siteCrew = false, groups } = opts;
    this.drawn.clear();
    this.hits = [];
    if (this.sheet === undefined || buildingId === null || field === null) {
      this.hideRest();
      this.container.visible = false;
      return;
    }
    const resident = groups !== undefined ? groupedWorkers(snapshot, groups) : undefined;
    const grouped = resident !== undefined && resident.ids.length > 0 ? resident : undefined;
    const workers = grouped?.ids ?? fieldWorkers(snapshot, buildingId, siteCrew);
    if (workers.length === 0) {
      this.hideRest();
      this.container.visible = false;
      return;
    }
    // Per-slot extra left gap, in slot widths; only a family-grouped field inserts one.
    const gapBefore = grouped?.gaps;

    const scene = buildSpriteScene(snapshot, {
      playerColourOf: this.playerColourOf,
      keepIndoorSettlers: true,
      onlyRefs: new Set(workers),
    });
    const items = new Map<number, DrawItem>();
    for (const it of scene) if (it.kind === 'settler') items.set(it.ref, it);

    const inner: Rect = {
      x: field.x + FIELD_PAD,
      y: field.y + FIELD_PAD,
      w: Math.max(1, field.w - 2 * FIELD_PAD),
      h: Math.max(1, field.h - 2 * FIELD_PAD),
    };
    // Pack left-to-right by a fixed cell width so two workers sit at the left rather than centred,
    // narrowing only where the row would otherwise run past the field's right edge.
    const cells = workers.length + (gapBefore?.reduce((a, b) => a + b, 0) ?? 0);
    const slotW = Math.min(inner.h * SLOT_W_FRAC, inner.w / cells);
    const feetY = inner.y + inner.h;

    // The field shares one zoom, sized so the tallest body fills CHAR_FILL of the field height, so a
    // baby beside its parents still reads baby-sized.
    const resolved = workers.map((id) => {
      const item = items.get(id);
      if (item === undefined) return null;
      const clock = item.frozen === true ? INDOOR_POSE_TICK : snapshot.tick;
      // Size the worker off its neutral standing frame, not the live one: each walk-cycle frame is a
      // differently-trimmed pixel rect, so normalising the current frame's height would rescale the
      // whole body every step.
      const stanceLayers = resolveLayers(this.sheet, item, INDOOR_POSE_TICK);
      const stanceBody = stanceLayers?.[0];
      if (stanceLayers === null || stanceBody === undefined) return null;
      const layers = clock === INDOOR_POSE_TICK ? stanceLayers : resolveLayers(this.sheet, item, clock);
      if (layers === null || layers.length === 0) return null;
      return { id, item, layers, bodyH: Math.max(1, stanceBody.frame.height * stanceBody.scale) };
    });
    const tallest = Math.max(1, ...resolved.map((r) => r?.bodyH ?? 1));
    const zoom = (inner.h * CHAR_FILL) / tallest;

    let gapOffset = 0;
    resolved.forEach((r, i) => {
      gapOffset += (gapBefore?.[i] ?? 0) * slotW;
      if (r === null) return;
      const cellX = inner.x + slotW * i + gapOffset;
      const feetX = cellX + slotW / 2;
      const lut = this.sheet?.palette;
      // Same (armor tier, player) LUT row the world pool binds, so the portrait matches the map look.
      const row = lut === undefined ? 0 : paletteLutRow(lut, r.item.player, r.item.armorGood);
      for (let li = 0; li < r.layers.length; li++) {
        const layer = r.layers[li];
        if (layer !== undefined) this.drawLayer(`${i}:${li}`, layer, feetX, feetY, zoom, row);
      }
      this.hits.push({ id: r.id, x: cellX, y: inner.y, w: slotW, h: inner.h });
    });

    this.hideRest();
    this.container.visible = true;
  }

  hitTest(x: number, y: number): number | null {
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.id;
    }
    return null;
  }

  dispose(): void {
    this.container.destroy({ children: true });
    this.sprites.clear();
    this.plainTextures.clear();
  }

  private drawLayer(
    key: string,
    layer: ResolvedLayer,
    feetX: number,
    feetY: number,
    zoom: number,
    playerRow: number,
  ): void {
    const lut = this.sheet?.palette;
    if (lut !== undefined) {
      let spr = this.sprites.get(key);
      if (!(spr instanceof PalettedSprite)) {
        spr?.destroy();
        spr = new PalettedSprite(lut.source, lut.colours);
        this.sprites.set(key, spr);
        this.container.addChild(spr);
      }
      spr.setFrame(
        layer.source,
        layer.frame,
        layer.atlasW ?? layer.frame.width,
        layer.atlasH ?? layer.frame.height,
      );
      spr.place(feetX, feetY, zoom * layer.scale, this.app.screen.width, this.app.screen.height);
      spr.player = playerRow;
      spr.visible = true;
    } else {
      // No LUT (baked-palette sheet): a plain feet-anchored sprite.
      let spr = this.sprites.get(key);
      if (spr instanceof PalettedSprite || spr === undefined) {
        spr?.destroy();
        spr = new Sprite();
        this.sprites.set(key, spr);
        this.container.addChild(spr);
      }
      spr.texture = this.plainTexture(layer.source, layer.frame);
      const w = layer.frame.width * zoom * layer.scale;
      const h = layer.frame.height * zoom * layer.scale;
      spr.width = w;
      spr.height = h;
      spr.position.set(
        feetX + layer.frame.offsetX * zoom * layer.scale,
        feetY + layer.frame.offsetY * zoom * layer.scale,
      );
      spr.visible = true;
    }
    this.drawn.add(key);
  }

  private plainTexture(source: ResolvedLayer['source'], frame: ResolvedLayer['frame']): Texture {
    const cached = this.plainTextures.get(frame);
    if (cached !== undefined) return cached;
    const tex = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    this.plainTextures.set(frame, tex);
    return tex;
  }

  /** Hide every pooled sprite not drawn this frame. */
  private hideRest(): void {
    for (const [key, spr] of this.sprites) if (!this.drawn.has(key)) spr.visible = false;
  }
}
