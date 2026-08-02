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
import { boundWorkers, groupedWorkers } from './worker-selection.js';

/**
 * The animated worker sprites drawn in the details panel's "Pracownicy" field - the settlers bound to
 * the selected building, drawn as on the map (their real body/head, team colour and current-action
 * animation) but with no terrain behind them, so the player sees who is working there.
 *
 * It is a live overlay, not part of the baked panel texture: the panel re-bakes at most 4 Hz (its values
 * barely change), but an animation must advance every frame - so the worker sprites are drawn straight to
 * the stage, one z above the baked panel, and re-resolved each tick. It reuses the world renderer's own
 * frame machinery ({@link buildSpriteScene} → {@link resolveLayers}) and draws each layer with a
 * {@link PalettedSprite} (the same team-coloured indexed-atlas mesh the map uses), self-placed by feet
 * anchor + scale - no camera. Without a loaded {@link SpriteSheet} (a bare checkout) it simply draws
 * nothing, so the panel still works.
 */

/** A worker who has stepped inside the building stands frozen on this fixed animation tick - a still
 *  standing pose in the panel (not the breathing wait loop), while active workers animate on the sim
 *  tick. 0 holds the idle sequence's first (neutral standing) frame. */
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
  /** One display object per (panel slot, layerIndex) - reused across frames AND across whichever worker
   *  occupies the slot, hidden when unused. Keyed by slot, not by entity, so a session spent clicking
   *  through buildings cannot grow this map past the field's slot count × the deepest layer stack. */
  private readonly sprites = new Map<string, PalettedSprite | Sprite>();
  /** Cached plain textures (the no-LUT fallback) keyed by atlas frame identity, so the fallback path
   *  doesn't mint a Texture every frame. */
  private readonly plainTextures = new Map<object, Texture>();
  private readonly drawn = new Set<string>();
  /** This frame's clickable worker boxes, rebuilt each update - the seam {@link hitTest} reads. */
  private hits: WorkerHit[] = [];

  constructor(
    private readonly app: Application,
    private readonly sheet: SpriteSheet | undefined,
    zIndex: number,
    /** Owner slot → team-colour slot (a map roster's colour choices), matching the map's own sprites. */
    private readonly playerColourOf?: (player: number) => number,
  ) {
    this.container.zIndex = zIndex;
    this.container.visible = false;
    app.stage.addChild(this.container);
  }

  /**
   * Redraw the workers of `buildingId` into `field` (screen px). A null building / field, or no sprite
   * sheet, clears the overlay. Called from the panel's `tick`, which skips it while its inputs hold - the
   * animation clock is `snapshot.tick`, so it advances once per sim tick.
   * `opts.siteCrew` selects the live build crew instead of the bound workers; `opts.groups` (a home's
   * residents, one id list per family) overrides the bound-worker scan - the field then draws each family
   * as a close cluster with a breather gap before the next. An EMPTY grouping is not an override: a home
   * still going up houses nobody yet, and blanking its field would hide the crew raising it.
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
    const workers = grouped?.ids ?? boundWorkers(snapshot, buildingId, siteCrew);
    if (workers.length === 0) {
      this.hideRest();
      this.container.visible = false;
      return;
    }
    // Per-slot extra left gap (in slot widths): a family-grouped field inserts a breather where a new
    // group starts; the flat worker field has none.
    const gapBefore = grouped?.gaps;

    // One scene build against the WHOLE snapshot, so each worker resolves against the same reads the map
    // uses: `onlyRefs` narrows the emit to these ≤8 settlers without starving the builder's
    // whole-snapshot pre-scans, which decide indoor state and target-derived facing. `keepIndoorSettlers`
    // adds the workers the map suppresses (sim `Resting` / mid-store-exchange), each tagged `frozen`.
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
    // Pack left-to-right by a fixed cell width (not spread across the whole field), so two workers sit at
    // the left rather than centred; cells past the field's right edge are simply not drawn.
    const slotW = inner.h * SLOT_W_FRAC;
    const feetY = inner.y + inner.h;

    // Resolve every drawn worker's layers first: the field shares ONE zoom - the tallest body fills
    // CHAR_FILL of the field height - so a baby beside its parents reads baby-sized instead of each
    // body being blown up to the same height.
    const resolved = workers.map((id) => {
      const item = items.get(id);
      if (item === undefined) return null;
      // A worker inside the building stands frozen; one out working animates on the sim tick.
      const clock = item.frozen === true ? INDOOR_POSE_TICK : snapshot.tick;
      // Size the worker off its NEUTRAL standing frame (INDOOR_POSE_TICK), not the live animation frame:
      // each walk-cycle frame is a differently-trimmed pixel rect (arms/legs extended → taller bbox), so
      // normalising the current frame's height would rescale the whole body every step - the "camera bob"
      // size pulse. The stance frame is stable, so the drawn size holds constant while the gait's own
      // per-frame offsets still animate the body within it.
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
      if (cellX + slotW > inner.x + inner.w + 1) return; // no room - overflow past the field's right edge
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

  /** The entity whose sprite covers screen point (x, y), or null - so a click in the field selects that
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
