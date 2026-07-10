import {
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
/** Inset from the field edges (screen px), the fraction of the field height a character fills, and one
 *  worker's cell width as a fraction of the field height (they pack LEFT-to-right by this width). */
const FIELD_PAD = 4;
const CHAR_FILL = 0.82;
const SLOT_W_FRAC = 0.72;

/** A snapshot entity, as `buildSpriteScene` consumes it — the narrowed scene reuses these objects. */
type WorkerEntity = WorldSnapshot['entities'][number];

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
  /** One display object per (workerId, layerIndex), reused across frames and hidden when unused. */
  private readonly sprites = new Map<string, PalettedSprite | Sprite>();
  /** Cached plain textures (the no-LUT fallback) keyed by atlas frame identity, so the fallback path
   *  doesn't mint a Texture every frame. */
  private readonly plainTextures = new Map<object, Texture>();
  private readonly drawn = new Set<string>();
  /** This frame's clickable worker boxes, rebuilt each update — the seam {@link hitTest} reads. */
  private hits: WorkerHit[] = [];

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
    this.hits = [];
    if (this.sheet === undefined || buildingId === null || field === null) {
      this.hideRest();
      this.container.visible = false;
      return;
    }
    const workerEntities = this.boundWorkers(snapshot, buildingId);
    if (workerEntities.length === 0) {
      this.hideRest();
      this.container.visible = false;
      return;
    }
    const workers = workerEntities.map((e) => e.id);

    // Resolve each worker's draw item the SAME way the map does — same frame, same facing (forcing a fixed
    // facing once made them animate walking the wrong way) — but project ONLY these ≤8 bound settlers, not
    // the whole map: this overlay runs every frame while a building panel is open, so a full
    // `buildSpriteScene(snapshot)` (an O(entities) project + sort, per render/AGENTS) just to look up 8 ids
    // would duplicate the renderer's own scene build for the entire map every frame. Feeding the builder a
    // snapshot narrowed to the bound workers keeps the identical projection while the cost tracks the panel.
    const items = new Map<number, DrawItem>();
    const workerScene: WorldSnapshot = { ...snapshot, entities: workerEntities };
    for (const it of buildSpriteScene(workerScene)) if (it.kind === 'settler') items.set(it.ref, it);

    const inner: Rect = {
      x: field.x + FIELD_PAD,
      y: field.y + FIELD_PAD,
      w: Math.max(1, field.w - 2 * FIELD_PAD),
      h: Math.max(1, field.h - 2 * FIELD_PAD),
    };
    // Pack LEFT-to-right by a fixed cell width (not spread across the whole field), so two workers sit at
    // the left rather than centred; cells past the field's right edge are simply not drawn.
    const slotW = inner.h * SLOT_W_FRAC;
    const feetY = inner.y + inner.h;

    workers.forEach((id, i) => {
      const cellX = inner.x + slotW * i;
      if (cellX + slotW > inner.x + inner.w + 1) return; // no room — overflow past the field's right edge
      const item = items.get(id);
      if (item === undefined) return;
      const layers = resolveLayers(this.sheet, item, snapshot.tick);
      if (layers === null || layers.length === 0) return;
      const body = layers[0];
      if (body === undefined) return;
      // Zoom so the body layer fills CHAR_FILL of the field height; every layer shares this zoom.
      const zoom = (inner.h * CHAR_FILL) / Math.max(1, body.frame.height * body.scale);
      const feetX = cellX + slotW / 2;
      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        if (layer !== undefined) this.drawLayer(`${id}:${li}`, layer, feetX, feetY, zoom, item.player ?? 0);
      }
      this.hits.push({ id, x: cellX, y: inner.y, w: slotW, h: inner.h });
    });

    this.hideRest();
    this.container.visible = true;
  }

  /** The entity whose sprite covers screen point (x, y), or null — so a click in the field selects that
   *  worker (the panel routes it, deselecting the building), exactly like clicking the settler on the map. */
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

  /** The (snapshot-ordered, capped) settler ENTITIES bound to `buildingId` — one O(entities) scan, whose
   *  result also narrows the sprite-scene build above. A view read, so snapshot order is fine. */
  private boundWorkers(snapshot: WorldSnapshot, buildingId: number): WorkerEntity[] {
    const out: WorkerEntity[] = [];
    for (const e of snapshot.entities) {
      if (out.length >= MAX_WORKERS) break;
      if (!isSettler(e)) continue;
      const assignment = e.components.JobAssignment as { workplace?: unknown } | undefined;
      if (num(assignment?.workplace) === buildingId) out.push(e);
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
