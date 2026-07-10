import {
  DEFAULT_FACING,
  type DrawItem,
  PalettedSprite,
  type ResolvedLayer,
  type SpriteSheet,
  buildSpriteScene,
  resolveLayers,
} from '@vinland/render';
import type { WorldSnapshot } from '@vinland/sim';
import {
  type Application,
  Container,
  type Container as PixiContainer,
  Rectangle,
  Sprite,
  Texture,
} from 'pixi.js';
import { isSettler, num } from '../../game/snapshot.js';
import type { Rect } from '../geometry.js';

/**
 * The animated WORKER SPRITES drawn in the details panel's "Pracownicy" field — the settlers bound to
 * the selected building, drawn AS ON THE MAP (their real body/head, team colour and current-action
 * animation) but with NO terrain behind them, so the player sees who is working there.
 *
 * It is a LIVE overlay, not part of the baked panel texture: the panel re-bakes at most 4 Hz (its values
 * barely change), but an animation must advance every frame — so the worker sprites are drawn straight to
 * the stage, one z above the baked panel, and re-resolved each tick. It reuses the world renderer's own
 * frame machinery ({@link buildSpriteScene} → {@link resolveLayers}) and draws each layer with a
 * {@link PalettedSprite} (the same team-coloured indexed-atlas mesh the map uses), self-placed by feet
 * anchor + scale — no camera. Without a loaded {@link SpriteSheet} (a bare checkout) it simply draws
 * nothing, so the panel still works.
 */

/** At most this many worker sprites in the field (a store dispatches up to ~12; keep the row readable). */
const MAX_WORKERS = 8;
/** Inset from the field edges, and the fraction of the field height a character fills (screen px). */
const FIELD_PAD = 4;
const CHAR_FILL = 0.82;

export class WorkerSpriteOverlay {
  private readonly container: PixiContainer = new Container();
  /** One display object per (workerId, layerIndex), reused across frames and hidden when unused. */
  private readonly sprites = new Map<string, PalettedSprite | Sprite>();
  /** Cached plain textures (the no-LUT fallback) keyed by atlas frame identity, so the fallback path
   *  doesn't mint a Texture every frame. */
  private readonly plainTextures = new Map<object, Texture>();
  private readonly drawn = new Set<string>();

  constructor(
    private readonly app: Application,
    private readonly sheet: SpriteSheet | undefined,
    zIndex: number,
  ) {
    this.container.zIndex = zIndex;
    this.container.visible = false;
    app.stage.addChild(this.container);
  }

  /**
   * Redraw the workers of `buildingId` into `field` (screen px). A null building / field, or no sprite
   * sheet, clears the overlay. Called every frame from the panel's `tick` so the animation advances.
   */
  update(snapshot: WorldSnapshot, buildingId: number | null, field: Rect | null): void {
    this.drawn.clear();
    if (this.sheet === undefined || buildingId === null || field === null) {
      this.hideRest();
      this.container.visible = false;
      return;
    }
    const workers = this.boundWorkers(snapshot, buildingId);
    if (workers.length === 0) {
      this.hideRest();
      this.container.visible = false;
      return;
    }

    // Index the frame's draw items by entity so each worker resolves the SAME frame it shows on the map.
    const items = new Map<number, DrawItem>();
    for (const it of buildSpriteScene(snapshot)) if (it.kind === 'settler') items.set(it.ref, it);

    const inner: Rect = {
      x: field.x + FIELD_PAD,
      y: field.y + FIELD_PAD,
      w: Math.max(1, field.w - 2 * FIELD_PAD),
      h: Math.max(1, field.h - 2 * FIELD_PAD),
    };
    const step = inner.w / workers.length;
    const feetY = inner.y + inner.h;

    workers.forEach((id, i) => {
      const base = items.get(id);
      if (base === undefined) return;
      // Face the viewer (a portrait pose), but keep the real state/clock so the action animates as on the map.
      const item: DrawItem = { ...base, facing: DEFAULT_FACING };
      const layers = resolveLayers(this.sheet, item, snapshot.tick);
      if (layers === null || layers.length === 0) return;
      const body = layers[0];
      if (body === undefined) return;
      // Zoom so the body layer fills CHAR_FILL of the field height; every layer shares this zoom.
      const zoom = (inner.h * CHAR_FILL) / Math.max(1, body.frame.height * body.scale);
      const feetX = inner.x + step * (i + 0.5);
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        if (layer !== undefined) this.drawLayer(`${id}:${li}`, layer, feetX, feetY, zoom, item.player ?? 0);
      }
    });

    this.hideRest();
    this.container.visible = true;
  }

  dispose(): void {
    this.container.destroy({ children: true });
    this.sprites.clear();
    this.plainTextures.clear();
  }

  /** The (id-ordered, capped) settlers bound to `buildingId` — a view read, so snapshot order is fine. */
  private boundWorkers(snapshot: WorldSnapshot, buildingId: number): number[] {
    const out: number[] = [];
    for (const e of snapshot.entities) {
      if (out.length >= MAX_WORKERS) break;
      if (!isSettler(e)) continue;
      const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
      if (num(assignment?.workplace) === buildingId) out.push(e.id);
    }
    return out;
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
      // No LUT (baked-palette sheet): a plain feet-anchored sprite, positioned bottom-centre at the anchor.
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

  /** A cached plain sub-texture for one atlas frame (the no-LUT fallback path only). */
  private plainTexture(source: ResolvedLayer['source'], frame: ResolvedLayer['frame']): Texture {
    const cached = this.plainTextures.get(frame);
    if (cached !== undefined) return cached;
    const tex = new Texture({ source, frame: new Rectangle(frame.x, frame.y, frame.width, frame.height) });
    this.plainTextures.set(frame, tex);
    return tex;
  }

  /** Hide every pooled sprite not drawn this frame (fewer workers than a previous frame, or cleared). */
  private hideRest(): void {
    for (const [key, spr] of this.sprites) if (!this.drawn.has(key)) spr.visible = false;
  }
}
